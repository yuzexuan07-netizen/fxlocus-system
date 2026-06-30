import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { dbAll, dbBatch, dbFirst, dbRun, sqlPlaceholders } from "@/lib/d1";
import { requireLearner } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { filterExistingProfileIds, resolveExistingProfileId } from "@/lib/system/profileRefs";
import { getR2Bucket, r2Enabled, r2ObjectExists } from "@/lib/storage/r2";
import { isLegacyR2BucketName, removeStoredObjects, uploadBufferToStorage } from "@/lib/storage/storage";
import { createD1TextId } from "@/lib/system/d1Id";
import { buildRequestScopedId, normalizeRequestId } from "@/lib/system/uploadIdempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

type JsonFileInput = {
  bucket?: string;
  path?: string;
  fileName?: string;
  size?: number;
  mimeType?: string | null;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function buildSubmissionFileId(submissionId: string, index: number) {
  return buildRequestScopedId("tradefile", submissionId, index);
}

function safeFilename(name: string) {
  return (name || "upload.bin").replace(/[^\w.\-()+\s]/g, "_").slice(0, 120) || "upload.bin";
}

function isAllowed(file: File) {
  const name = String(file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  const mime = String(file.type || "").toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIME_TYPES.has(mime);
}

function isAllowedMeta(name: string, mime: string | null) {
  const lower = String(name || "").toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";
  const safeMime = String(mime || "").toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIME_TYPES.has(safeMime);
}

function hasValidSize(size: number) {
  return Number.isFinite(size) && size > 0;
}

function isR2BackedBucket(bucket: string) {
  const r2Bucket = getR2Bucket();
  return r2Enabled() && Boolean((r2Bucket && bucket === r2Bucket) || isLegacyR2BucketName(bucket));
}

async function ensureR2ObjectReady(path: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await r2ObjectExists(path)) return true;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  return false;
}

async function notifyAdmins(user: {
  id: string;
  email?: string | null;
  full_name?: string | null;
  leader_id?: string | null;
}) {
  const admins = await dbAll<{ id: string | null }>(
    "select id from profiles where role = ?",
    ["super_admin"]
  );
  const targets = await filterExistingProfileIds([
    user.leader_id || null,
    ...(admins || []).map((a) => (a?.id ? String(a.id) : null))
  ]);
  if (!targets.length) return;
  const label = user.full_name || user.email || user.id.slice(0, 6);
  const now = new Date().toISOString();
  const rows = targets.map((id) => ({
    sql: "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
    params: [
      id,
      user.id,
      "模拟交易日志提交 / Simulation trade log submitted",
      `学员 ${label} 已提交模拟交易日志。\n\nStudent ${label} submitted simulation trade logs.`,
      now
    ]
  }));
  await dbBatch(rows);
}

export async function POST(req: Request) {
  try {
    const { user } = await requireLearner();
    const safeLeaderId = await resolveExistingProfileId(user.leader_id);
    const actorForNotify = { ...user, leader_id: safeLeaderId };
    const storageAdmin = dbAdmin();
    const now = new Date().toISOString();
    const bucketCandidates = r2Enabled()
      ? [getR2Bucket()]
      : ([process.env.SYSTEM_FILES_BUCKET, process.env.R2_BUCKET, "fxlocus-system-files"].filter(Boolean) as string[]);
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const payload = await req.json().catch(() => null);
      const requestId = normalizeRequestId(payload?.requestId);
      const rawFiles = Array.isArray(payload?.files) ? (payload.files as JsonFileInput[]) : [];
      if (!rawFiles.length) return json({ ok: false, error: "MISSING_FILES" }, 400);
      if (rawFiles.length > 3) return json({ ok: false, error: "TOO_MANY_FILES" }, 400);

      const replace = payload?.replace === true;
      const submissionIdRaw = typeof payload?.submissionId === "string" ? payload.submissionId.trim() : "";
      if (replace && !submissionIdRaw) return json({ ok: false, error: "INVALID_SUBMISSION" }, 400);
      if (submissionIdRaw.length > 128) {
        return json({ ok: false, error: "INVALID_SUBMISSION" }, 400);
      }

      const submissionId =
        submissionIdRaw || (requestId ? buildRequestScopedId("tradelog", user.id, requestId) : createD1TextId());
      const expectedPrefix = `trade-logs/${user.id}/${submissionId}/`;
      const normalizedFiles = rawFiles.map((file) => {
        const fileName = String(file.fileName || "").trim();
        const safeName = safeFilename(fileName);
        return {
          bucket: String(file.bucket || "").trim(),
          path: String(file.path || "").trim(),
          fileName: fileName || safeName,
          size: Number(file.size || 0),
          mimeType: file.mimeType ? String(file.mimeType) : null
        };
      });

      for (const file of normalizedFiles) {
        if (!file.path || !file.bucket) return json({ ok: false, error: "INVALID_FILE" }, 400);
        if (!hasValidSize(file.size)) {
          return json({ ok: false, error: "EMPTY_FILE" }, 400);
        }
        if (!bucketCandidates.includes(file.bucket)) {
          return json({ ok: false, error: "INVALID_BUCKET" }, 400);
        }
        if (!file.path.startsWith(expectedPrefix)) {
          return json({ ok: false, error: "INVALID_PATH" }, 400);
        }
        if (!isAllowedMeta(file.fileName, file.mimeType)) {
          return json({ ok: false, error: "INVALID_FILE_TYPE" }, 400);
        }
      }
      for (const file of normalizedFiles) {
        if (!isR2BackedBucket(file.bucket)) continue;
        const exists = await ensureR2ObjectReady(file.path);
        if (!exists) return json({ ok: false, error: "MISSING_OBJECT" }, 400);
      }

      let oldFiles: Array<{ id: string; storage_bucket: string; storage_path: string }> = [];

      if (replace) {
        const existing = await dbFirst<any>(
          "select id,user_id,type,status from trade_submissions where id = ? limit 1",
          [submissionId]
        );
        if (!existing?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
        if (existing.user_id !== user.id || existing.type !== "trade_log") {
          return json({ ok: false, error: "FORBIDDEN" }, 403);
        }
        if (existing.status !== "submitted") {
          return json({ ok: false, error: "ALREADY_REVIEWED" }, 400);
        }

        const existingFiles = await dbAll<any>(
          "select id,storage_bucket,storage_path from trade_submission_files where submission_id = ?",
          [submissionId]
        );
        oldFiles = (existingFiles || []) as any;
      } else {
        try {
          await dbRun(
            "insert into trade_submissions (id,user_id,leader_id,type,status,created_at,updated_at) values (?, ?, ?, ?, ?, ?, ?)",
            [submissionId, user.id, safeLeaderId, "trade_log", "submitted", now, now]
          );
        } catch (err) {
          const existing = await dbFirst<any>("select id,user_id,type from trade_submissions where id = ? limit 1", [submissionId]);
          if (!existing?.id || existing.user_id !== user.id || existing.type !== "trade_log") throw err;
        }
      }

      const fileRows = normalizedFiles.map((file, index) => ({
        id: buildSubmissionFileId(submissionId, index),
        submission_id: submissionId,
        file_name: file.fileName,
        storage_bucket: file.bucket,
        storage_path: file.path,
        size_bytes: file.size,
        mime_type: file.mimeType,
        created_at: now
      }));

      if (fileRows.length) {
        const statements = fileRows.map((file) => ({
          sql: "insert into trade_submission_files (id,submission_id,file_name,storage_bucket,storage_path,size_bytes,mime_type,created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
          params: [
            file.id,
            file.submission_id,
            file.file_name,
            file.storage_bucket,
            file.storage_path,
            file.size_bytes,
            file.mime_type,
            file.created_at
          ]
        }));
        try {
          await dbBatch(statements);
        } catch (err) {
          const existingRows = await dbAll<{ id: string }>(
            `select id from trade_submission_files where id in (${sqlPlaceholders(fileRows.length)})`,
            fileRows.map((file) => file.id)
          );
          const existingIds = new Set((existingRows || []).map((row) => String(row.id || "")));
          if (fileRows.every((file) => existingIds.has(file.id))) {
            return json({ ok: true, id: submissionId, duplicated: true });
          }
          throw err;
        }
      }

      if (replace) {
        await dbRun(
          "update trade_submissions set leader_id = ?, status = ?, review_note = null, rejection_reason = null, reviewed_at = null, reviewed_by = null, created_at = ?, updated_at = ? where id = ?",
          [safeLeaderId, "submitted", now, now, submissionId]
        );

        if (oldFiles.length) {
          const oldIds = oldFiles.map((f) => f.id);
          if (oldIds.length) {
            await dbRun(
              `delete from trade_submission_files where id in (${sqlPlaceholders(oldIds.length)})`,
              oldIds
            );
          }

          await removeStoredObjects(
            storageAdmin,
            oldFiles.map((file) => ({ bucket: file.storage_bucket, path: file.storage_path }))
          );
        }
      }

      await notifyAdmins(actorForNotify);
      return json({ ok: true, id: submissionId });
    }

    const form = await req.formData().catch(() => null);
    if (!form) return json({ ok: false, error: "INVALID_FORM" }, 400);
    const requestId = normalizeRequestId(form.get("requestId"));

    const files = form.getAll("files").filter((f) => f instanceof File) as File[];
    if (!files.length) return json({ ok: false, error: "MISSING_FILES" }, 400);
    if (files.length > 3) return json({ ok: false, error: "TOO_MANY_FILES" }, 400);

    for (const file of files) {
      if (!isAllowed(file)) return json({ ok: false, error: "INVALID_FILE_TYPE" }, 400);
      if (!hasValidSize(file.size)) return json({ ok: false, error: "EMPTY_FILE" }, 400);
    }

    const submissionIdRaw = form.get("submissionId");
    const replaceId = typeof submissionIdRaw === "string" ? submissionIdRaw.trim() : "";
    const isReplace = Boolean(replaceId);
    if (replaceId.length > 128) {
      return json({ ok: false, error: "INVALID_SUBMISSION" }, 400);
    }

    const submissionId = replaceId || (requestId ? buildRequestScopedId("tradelog", user.id, requestId) : createD1TextId());
    let oldFiles: Array<{ id: string; storage_bucket: string; storage_path: string }> = [];

    if (isReplace) {
      const existing = await dbFirst<any>(
        "select id,user_id,type,status from trade_submissions where id = ? limit 1",
        [submissionId]
      );
      if (!existing?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
      if (existing.user_id !== user.id || existing.type !== "trade_log") {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }
      if (existing.status !== "submitted") {
        return json({ ok: false, error: "ALREADY_REVIEWED" }, 400);
      }

      const existingFiles = await dbAll<any>(
        "select id,storage_bucket,storage_path from trade_submission_files where submission_id = ?",
        [submissionId]
      );
      oldFiles = (existingFiles || []) as any;
    } else {
      try {
        await dbRun(
          "insert into trade_submissions (id,user_id,leader_id,type,status,created_at,updated_at) values (?, ?, ?, ?, ?, ?, ?)",
          [submissionId, user.id, safeLeaderId, "trade_log", "submitted", now, now]
        );
      } catch (err) {
        const existing = await dbFirst<any>("select id,user_id,type from trade_submissions where id = ? limit 1", [submissionId]);
        if (!existing?.id || existing.user_id !== user.id || existing.type !== "trade_log") throw err;
      }
    }

    const uploaded: Array<{ bucket: string; path: string }> = [];
    const newPaths: string[] = [];
    const fileRows: any[] = [];

    try {
      const uploadOne = async (file: File, index: number) => {
        const originalName = String(file.name || "").trim();
        const safeName = safeFilename(originalName);
        const displayName = originalName || safeName;
        const path = requestId
          ? `trade-logs/${user.id}/${submissionId}/${String(index).padStart(2, "0")}-${safeName}`
          : `trade-logs/${user.id}/${submissionId}/${Date.now()}-${randomUUID()}-${safeName}`;
        const bytes = await file.arrayBuffer();

        let bucketUsed = bucketCandidates[0] || "fxlocus-system-files";
        let uploadError: Error | null = null;
        for (const candidate of bucketCandidates.length ? bucketCandidates : [bucketUsed]) {
          try {
            await uploadBufferToStorage(
              storageAdmin,
              candidate,
              path,
              bytes,
              file.type || "application/octet-stream"
            );
            bucketUsed = candidate;
            uploadError = null;
            break;
          } catch (err: any) {
            uploadError = err instanceof Error ? err : new Error(String(err || "UPLOAD_FAILED"));
            if (!/bucket/i.test(uploadError.message)) break;
          }
        }
        if (uploadError) throw uploadError;

        uploaded.push({ bucket: bucketUsed, path });
        newPaths.push(path);
        return {
          id: buildSubmissionFileId(submissionId, index),
          submission_id: submissionId,
          file_name: displayName,
          storage_bucket: bucketUsed,
          storage_path: path,
          size_bytes: file.size,
          mime_type: file.type || null,
          created_at: now
        };
      };

      const rows = await Promise.all(files.map((file, index) => uploadOne(file, index)));
      fileRows.push(...rows);

      if (fileRows.length) {
        const statements = fileRows.map((file) => ({
          sql: "insert into trade_submission_files (id,submission_id,file_name,storage_bucket,storage_path,size_bytes,mime_type,created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
          params: [
            file.id,
            file.submission_id,
            file.file_name,
            file.storage_bucket,
            file.storage_path,
            file.size_bytes,
            file.mime_type,
            file.created_at
          ]
        }));
        try {
          await dbBatch(statements);
        } catch (err) {
          const existingRows = await dbAll<{ id: string }>(
            `select id from trade_submission_files where id in (${sqlPlaceholders(fileRows.length)})`,
            fileRows.map((file) => file.id)
          );
          const existingIds = new Set((existingRows || []).map((row) => String(row.id || "")));
          if (fileRows.every((file) => existingIds.has(file.id))) {
            return json({ ok: true, id: submissionId, duplicated: true });
          }
          throw err;
        }
      }

      if (isReplace) {
        await dbRun(
          "update trade_submissions set leader_id = ?, status = ?, review_note = null, rejection_reason = null, reviewed_at = null, reviewed_by = null, created_at = ?, updated_at = ? where id = ?",
          [safeLeaderId, "submitted", now, now, submissionId]
        );

        if (oldFiles.length) {
          const oldIds = oldFiles.map((f) => f.id);
          if (oldIds.length) {
            await dbRun(
              `delete from trade_submission_files where id in (${sqlPlaceholders(oldIds.length)})`,
              oldIds
            );
          }

          await removeStoredObjects(
            storageAdmin,
            oldFiles.map((file) => ({ bucket: file.storage_bucket, path: file.storage_path }))
          );
        }
      }
    } catch (err: any) {
      await removeStoredObjects(storageAdmin, uploaded);
      if (newPaths.length) {
        await dbRun(
          `delete from trade_submission_files where submission_id = ? and storage_path in (${sqlPlaceholders(
            newPaths.length
          )})`,
          [submissionId, ...newPaths]
        );
      }
      if (!isReplace) {
        await dbRun("delete from trade_submissions where id = ?", [submissionId]);
      }
      return json({ ok: false, error: err?.message || "UPLOAD_FAILED" }, 500);
    }

    await notifyAdmins(actorForNotify);

    return json({ ok: true, id: submissionId });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
