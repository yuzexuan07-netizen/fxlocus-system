import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { requireLearner } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { buildStudentSubmitContent, notifyLeadersAndAdmins } from "@/lib/system/notify";
import { resolveExistingProfileId } from "@/lib/system/profileRefs";
import { getR2Bucket, r2Enabled, r2ObjectExists } from "@/lib/storage/r2";
import { isLegacyR2BucketName, removeStoredObjects, uploadBufferToStorage } from "@/lib/storage/storage";
import { dbFirst, dbRun } from "@/lib/d1";
import { createD1TextId } from "@/lib/system/d1Id";
import { buildRequestScopedId, normalizeRequestId } from "@/lib/system/uploadIdempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "heic", "heif", "jfif"]);
const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
  "image/heic",
  "image/heif"
]);
const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx", "pdf", "txt"]);
const DOCUMENT_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msexcel",
  "application/x-msexcel",
  "application/x-excel",
  "application/pdf",
  "text/plain"
]);
const MAX_BYTES = 20 * 1024 * 1024;
const SUMMARY_KEYS = ["strategy", "curve", "stats"] as const;
const SUMMARY_KEY_SET = new Set<string>(SUMMARY_KEYS);

type SummaryKey = (typeof SUMMARY_KEYS)[number];
type FieldTexts = Record<SummaryKey, string>;

type JsonFileInput = {
  key?: SummaryKey;
  bucket?: string;
  path?: string;
  fileName?: string;
  size?: number;
  mimeType?: string | null;
};

type ExistingWeeklySummary = {
  id: string;
  user_id: string;
  summary_text: string | null;
  strategy_text: string | null;
  strategy_bucket: string | null;
  strategy_path: string | null;
  curve_text: string | null;
  curve_bucket: string | null;
  curve_path: string | null;
  stats_text: string | null;
  stats_bucket: string | null;
  stats_path: string | null;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function safeFilename(name: string, fallback: string) {
  const raw = name && name.trim() ? name : fallback;
  return raw.replace(/[^\w.\-()+\s]/g, "_").slice(0, 120) || fallback;
}

function isImageLikeMime(mime: string) {
  return mime.startsWith("image/");
}

function isAllowed(file: File) {
  const name = String(file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  const mime = String(file.type || "").toLowerCase();
  return (
    IMAGE_EXTENSIONS.has(ext) ||
    IMAGE_MIME_TYPES.has(mime) ||
    DOCUMENT_EXTENSIONS.has(ext) ||
    DOCUMENT_MIME_TYPES.has(mime) ||
    isImageLikeMime(mime)
  );
}

function isAllowedMeta(name: string, mime: string | null) {
  const lower = String(name || "").toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";
  const safeMime = String(mime || "").toLowerCase();
  return (
    IMAGE_EXTENSIONS.has(ext) ||
    IMAGE_MIME_TYPES.has(safeMime) ||
    DOCUMENT_EXTENSIONS.has(ext) ||
    DOCUMENT_MIME_TYPES.has(safeMime) ||
    isImageLikeMime(safeMime)
  );
}

function normalizeFieldTexts(_source: any): FieldTexts {
  return {
    strategy: "",
    curve: "",
    stats: ""
  };
}

function normalizeFormFieldTexts(_form: FormData): FieldTexts {
  return {
    strategy: "",
    curve: "",
    stats: ""
  };
}

function hasExistingFile(existing: ExistingWeeklySummary | null | undefined, key: SummaryKey) {
  return Boolean(existing?.[`${key}_bucket`] && existing?.[`${key}_path`]);
}

function validateCompleteFields(
  _fieldTexts: FieldTexts,
  fileByKey: Map<SummaryKey, unknown>,
  existing?: ExistingWeeklySummary | null
) {
  return SUMMARY_KEYS.every((key) => fileByKey.has(key) || hasExistingFile(existing, key));
}

function buildSummaryText(summaryText: string) {
  const trimmed = summaryText.trim();
  if (trimmed) return trimmed;
  return "Attachments submitted.";
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

async function uploadFile(
  admin: ReturnType<typeof dbAdmin>,
  bucketCandidates: string[],
  file: File,
  prefix: string,
  userId: string,
  defaultExt: string
) {
  const safeName = safeFilename(file.name || "", `${prefix}.${defaultExt}`);
  const path = `weekly-summaries/${userId}/${Date.now()}-${randomUUID()}-${prefix}-${safeName}`;
  const bytes = await file.arrayBuffer();

  let bucketUsed = bucketCandidates[0];
  let uploadError: Error | null = null;
  for (const candidate of bucketCandidates) {
    try {
      await uploadBufferToStorage(admin, candidate, path, bytes, file.type || "application/octet-stream");
      bucketUsed = candidate;
      uploadError = null;
      break;
    } catch (err: any) {
      uploadError = err instanceof Error ? err : new Error(String(err || "UPLOAD_FAILED"));
      if (!/bucket/i.test(uploadError.message)) break;
    }
  }

  if (uploadError) throw uploadError;

  return {
    bucket: bucketUsed,
    path,
    name: file.name || safeName,
    mime: file.type || null
  };
}

export async function POST(req: Request) {
  try {
    const { user } = await requireLearner();
    const defaultExt = "bin";
    const contentType = req.headers.get("content-type") || "";

    const fallbackLabel = user.id ? user.id.slice(0, 6) : "student";
    const studentName = String(user.full_name || user.email || fallbackLabel).trim();
    const safeLeaderId = await resolveExistingProfileId(user.leader_id);

    if (contentType.includes("application/json")) {
      const payload = await req.json().catch(() => null);
      const summaryText = String(payload?.summaryText || "").trim();
      const fieldTexts = normalizeFieldTexts(payload);
      const entryIdRaw = typeof payload?.entryId === "string" ? payload.entryId.trim() : "";
      const requestId = normalizeRequestId(payload?.requestId);
      if (entryIdRaw.length > 128) return json({ ok: false, error: "INVALID_ENTRY" }, 400);
      const entryId = entryIdRaw || (requestId ? buildRequestScopedId("weekly", user.id, requestId) : createD1TextId());

      const rawFiles = Array.isArray(payload?.files) ? (payload.files as JsonFileInput[]) : [];
      const normalizedFiles = rawFiles.map((file) => {
        const key = file.key;
        const fileName = String(file.fileName || "").trim();
        const safeName = safeFilename(fileName, `${key || "file"}.${defaultExt}`);
        return {
          key,
          bucket: String(file.bucket || "").trim(),
          path: String(file.path || "").trim(),
          fileName: fileName || safeName,
          size: Number(file.size || 0),
          mimeType: file.mimeType ? String(file.mimeType) : null
        };
      });

      const keySet = new Set<SummaryKey>();
      for (const file of normalizedFiles) {
        if (!file.key || !SUMMARY_KEY_SET.has(file.key) || keySet.has(file.key)) {
          return json({ ok: false, error: "INVALID_FILES" }, 400);
        }
        keySet.add(file.key);
      }

      const expectedPrefix = `weekly-summaries/${user.id}/${entryId}/`;
      const bucketCandidates = r2Enabled()
        ? [getR2Bucket()]
        : ([
            process.env.SYSTEM_WEEKLY_SUMMARIES_BUCKET,
            "fxlocus_weekly_summaries",
            "fxlocus-weekly-summaries"
          ].filter(Boolean) as string[]);
      if (!bucketCandidates.length) bucketCandidates.push("fxlocus_weekly_summaries");

      for (const file of normalizedFiles) {
        if (!file.path || !file.bucket) return json({ ok: false, error: "INVALID_FILE" }, 400);
        if (!bucketCandidates.includes(file.bucket)) {
          return json({ ok: false, error: "INVALID_BUCKET" }, 400);
        }
        if (!file.path.startsWith(expectedPrefix)) {
          return json({ ok: false, error: "INVALID_PATH" }, 400);
        }
        if (!isAllowedMeta(file.fileName, file.mimeType)) {
          return json({ ok: false, error: "INVALID_FILE_TYPE" }, 400);
        }
        if (file.size > MAX_BYTES) return json({ ok: false, error: "FILE_TOO_LARGE" }, 400);
      }
      for (const file of normalizedFiles) {
        if (!isR2BackedBucket(file.bucket)) continue;
        const exists = await ensureR2ObjectReady(file.path);
        if (!exists) return json({ ok: false, error: "MISSING_OBJECT" }, 400);
      }

      const admin = dbAdmin();
      const now = new Date().toISOString();

      const existing = await dbFirst<ExistingWeeklySummary>(
        [
          "select id, user_id, summary_text,",
          "strategy_text, strategy_bucket, strategy_path,",
          "curve_text, curve_bucket, curve_path,",
          "stats_text, stats_bucket, stats_path",
          "from weekly_summaries where id = ? limit 1"
        ].join(" "),
        [entryId]
      );
      if (existing?.id && existing.user_id !== user.id) {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }

      const isNew = !existing?.id;

      const fileByKey = new Map(normalizedFiles.map((file) => [file.key as SummaryKey, file]));
      if (!validateCompleteFields(fieldTexts, fileByKey, existing)) {
        return json({ ok: false, error: "MISSING_FIELDS" }, 400);
      }
      const persistedSummaryText = buildSummaryText(summaryText);
      if (
        requestId &&
        existing?.id &&
        persistedSummaryText === String(existing.summary_text || "").trim() &&
        normalizedFiles.every((file) => String((existing as any)[`${file.key}_path`] || "") === file.path)
      ) {
        return json({ ok: true, id: entryId, duplicated: true });
      }
      const payloadUpdate: Record<string, unknown> = {
        student_name: studentName,
        summary_text: persistedSummaryText,
        strategy_text: fieldTexts.strategy,
        curve_text: fieldTexts.curve,
        stats_text: fieldTexts.stats,
        leader_id: safeLeaderId,
        reviewed_at: null,
        reviewed_by: null,
        review_note: null,
        updated_at: now
      };

      const replaced: Array<{ bucket: string; path: string }> = [];
      const addFile = (key: "strategy" | "curve" | "stats") => {
        const file = fileByKey.get(key);
        if (!file) return;
        payloadUpdate[`${key}_bucket`] = file.bucket;
        payloadUpdate[`${key}_path`] = file.path;
        payloadUpdate[`${key}_name`] = file.fileName;
        payloadUpdate[`${key}_mime_type`] = file.mimeType;
        if (existing?.id) {
          const oldBucket = (existing as any)[`${key}_bucket`];
          const oldPath = (existing as any)[`${key}_path`];
          if (oldBucket && oldPath) replaced.push({ bucket: oldBucket, path: oldPath });
        }
      };

      addFile("strategy");
      addFile("curve");
      addFile("stats");

      if (isNew) {
        const strategyFile = fileByKey.get("strategy");
        const curveFile = fileByKey.get("curve");
        const statsFile = fileByKey.get("stats");
        payloadUpdate.created_at = now;
        await dbRun(
          [
            "insert into weekly_summaries (id, user_id, leader_id, student_name, summary_text,",
            "strategy_text,",
            "strategy_bucket, strategy_path, strategy_name, strategy_mime_type,",
            "curve_text,",
            "curve_bucket, curve_path, curve_name, curve_mime_type,",
            "stats_text,",
            "stats_bucket, stats_path, stats_name, stats_mime_type, created_at, updated_at)",
            "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          ].join(" "),
          [
            entryId,
            user.id,
            safeLeaderId,
            studentName,
            persistedSummaryText,
            fieldTexts.strategy,
            strategyFile?.bucket || "",
            strategyFile?.path || "",
            strategyFile?.fileName || null,
            strategyFile?.mimeType || null,
            fieldTexts.curve,
            curveFile?.bucket || "",
            curveFile?.path || "",
            curveFile?.fileName || null,
            curveFile?.mimeType || null,
            fieldTexts.stats,
            statsFile?.bucket || "",
            statsFile?.path || "",
            statsFile?.fileName || null,
            statsFile?.mimeType || null,
            now,
            now
          ]
        );

        const inserted = await dbFirst<{ id: string }>(
          "select id from weekly_summaries where id = ? limit 1",
          [entryId]
        );
        if (!inserted?.id) {
          if (normalizedFiles.length) {
            await removeStoredObjects(
              admin,
              normalizedFiles.map((file) => ({ bucket: file.bucket, path: file.path }))
            );
          }
          return json({ ok: false, error: "DB_ERROR" }, 500);
        }
      } else {
        const setParts = Object.keys(payloadUpdate).map((key) => `${key} = ?`);
        const params = Object.values(payloadUpdate);
        params.push(entryId);
        try {
          await dbRun(`update weekly_summaries set ${setParts.join(", ")} where id = ?`, params);
        } catch {
          if (normalizedFiles.length) {
            await removeStoredObjects(
              admin,
              normalizedFiles.map((file) => ({ bucket: file.bucket, path: file.path }))
            );
          }
          return json({ ok: false, error: "DB_ERROR" }, 500);
        }
      }

      if (replaced.length) {
        await removeStoredObjects(admin, replaced);
      }

      await notifyLeadersAndAdmins(user, {
        title: "周总结提交 / Weekly summary submitted",
        content: buildStudentSubmitContent(user, isNew ? "提交了周总结。" : "更新了周总结。", isNew ? "submitted a weekly summary." : "updated a weekly summary.")
      });

      return json({ ok: true, id: entryId });
    }

    const form = await req.formData().catch(() => null);
    if (!form) return json({ ok: false, error: "INVALID_FORM" }, 400);
    const requestId = normalizeRequestId(form.get("requestId"));

    const summaryRaw = form.get("summaryText");
    const summaryText = typeof summaryRaw === "string" ? summaryRaw.trim() : "";
    const fieldTexts = normalizeFormFieldTexts(form);

    const entryIdRaw = form.get("entryId");
    const entryId = typeof entryIdRaw === "string" ? entryIdRaw.trim() : "";
    if (entryId.length > 128) return json({ ok: false, error: "INVALID_ENTRY" }, 400);

    const strategyFile = form.get("strategy");
    const curveFile = form.get("curve");
    const statsFile = form.get("stats");
    const strategy = strategyFile instanceof File ? strategyFile : null;
    const curve = curveFile instanceof File ? curveFile : null;
    const stats = statsFile instanceof File ? statsFile : null;

    for (const file of [strategy, curve, stats]) {
      if (!file) continue;
      if (!isAllowed(file)) return json({ ok: false, error: "INVALID_FILE_TYPE" }, 400);
      if (file.size > MAX_BYTES) return json({ ok: false, error: "FILE_TOO_LARGE" }, 400);
    }

    const bucketCandidates = r2Enabled()
      ? [getR2Bucket()]
      : ([
          process.env.SYSTEM_WEEKLY_SUMMARIES_BUCKET,
          "fxlocus_weekly_summaries",
          "fxlocus-weekly-summaries"
        ].filter(Boolean) as string[]);
    if (!bucketCandidates.length) bucketCandidates.push("fxlocus_weekly_summaries");

    const admin = dbAdmin();
    const now = new Date().toISOString();
    const uploaded: Array<{ bucket: string; path: string }> = [];
    let oldFiles: {
      strategy?: { bucket: string; path: string };
      curve?: { bucket: string; path: string };
      stats?: { bucket: string; path: string };
    } = {};
    let existingSummary: ExistingWeeklySummary | null = null;

    if (entryId) {
      const existing = await dbFirst<ExistingWeeklySummary>(
        [
          "select id, user_id, summary_text,",
          "strategy_text, strategy_bucket, strategy_path,",
          "curve_text, curve_bucket, curve_path,",
          "stats_text, stats_bucket, stats_path",
          "from weekly_summaries where id = ? limit 1"
        ].join(" "),
        [entryId]
      );
      if (!existing?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
      if (existing.user_id !== user.id) return json({ ok: false, error: "FORBIDDEN" }, 403);
      existingSummary = existing;
      if (existing.strategy_bucket && existing.strategy_path) {
        oldFiles.strategy = { bucket: existing.strategy_bucket, path: existing.strategy_path };
      }
      if (existing.curve_bucket && existing.curve_path) {
        oldFiles.curve = { bucket: existing.curve_bucket, path: existing.curve_path };
      }
      if (existing.stats_bucket && existing.stats_path) {
        oldFiles.stats = { bucket: existing.stats_bucket, path: existing.stats_path };
      }
    }

    const incomingFileByKey = new Map<SummaryKey, File>();
    if (strategy) incomingFileByKey.set("strategy", strategy);
    if (curve) incomingFileByKey.set("curve", curve);
    if (stats) incomingFileByKey.set("stats", stats);
    if (!validateCompleteFields(fieldTexts, incomingFileByKey, existingSummary)) {
      return json({ ok: false, error: "MISSING_FIELDS" }, 400);
    }
    const persistedSummaryText = buildSummaryText(summaryText);

    const uploads: {
      strategy?: Awaited<ReturnType<typeof uploadFile>>;
      curve?: Awaited<ReturnType<typeof uploadFile>>;
      stats?: Awaited<ReturnType<typeof uploadFile>>;
    } = {};

    try {
      if (strategy) {
        uploads.strategy = await uploadFile(admin, bucketCandidates, strategy, "strategy", requestId ? `${user.id}/${buildRequestScopedId("weekly", user.id, requestId)}` : user.id, defaultExt);
        uploaded.push({ bucket: uploads.strategy.bucket, path: uploads.strategy.path });
      }
      if (curve) {
        uploads.curve = await uploadFile(admin, bucketCandidates, curve, "curve", requestId ? `${user.id}/${buildRequestScopedId("weekly", user.id, requestId)}` : user.id, defaultExt);
        uploaded.push({ bucket: uploads.curve.bucket, path: uploads.curve.path });
      }
      if (stats) {
        uploads.stats = await uploadFile(admin, bucketCandidates, stats, "stats", requestId ? `${user.id}/${buildRequestScopedId("weekly", user.id, requestId)}` : user.id, defaultExt);
        uploaded.push({ bucket: uploads.stats.bucket, path: uploads.stats.path });
      }
    } catch {
      if (uploaded.length) {
        await removeStoredObjects(admin, uploaded);
      }
      return json({ ok: false, error: "UPLOAD_FAILED" }, 500);
    }

    if (entryId) {
      const payload: Record<string, unknown> = {
        student_name: studentName,
        summary_text: persistedSummaryText,
        strategy_text: fieldTexts.strategy,
        curve_text: fieldTexts.curve,
        stats_text: fieldTexts.stats,
        leader_id: safeLeaderId,
        reviewed_at: null,
        reviewed_by: null,
        review_note: null,
        updated_at: now
      };

      if (uploads.strategy) {
        payload.strategy_bucket = uploads.strategy.bucket;
        payload.strategy_path = uploads.strategy.path;
        payload.strategy_name = uploads.strategy.name;
        payload.strategy_mime_type = uploads.strategy.mime;
      }
      if (uploads.curve) {
        payload.curve_bucket = uploads.curve.bucket;
        payload.curve_path = uploads.curve.path;
        payload.curve_name = uploads.curve.name;
        payload.curve_mime_type = uploads.curve.mime;
      }
      if (uploads.stats) {
        payload.stats_bucket = uploads.stats.bucket;
        payload.stats_path = uploads.stats.path;
        payload.stats_name = uploads.stats.name;
        payload.stats_mime_type = uploads.stats.mime;
      }

      const setParts = Object.keys(payload).map((key) => `${key} = ?`);
      const params = Object.values(payload);
      params.push(entryId);
      try {
        await dbRun(`update weekly_summaries set ${setParts.join(", ")} where id = ?`, params);
      } catch {
        if (uploaded.length) {
          await removeStoredObjects(admin, uploaded);
        }
        return json({ ok: false, error: "DB_ERROR" }, 500);
      }

      const removals: Array<{ bucket: string; path: string }> = [];
      if (uploads.strategy && oldFiles.strategy) removals.push(oldFiles.strategy);
      if (uploads.curve && oldFiles.curve) removals.push(oldFiles.curve);
      if (uploads.stats && oldFiles.stats) removals.push(oldFiles.stats);
      if (removals.length) {
        await removeStoredObjects(admin, removals);
      }

      await notifyLeadersAndAdmins(user, {
        title: "周总结提交 / Weekly summary submitted",
        content: buildStudentSubmitContent(user, "已更新周总结。", "updated a weekly summary.")
      });

      return json({ ok: true, id: entryId });
    }

    const newId = requestId ? buildRequestScopedId("weekly", user.id, requestId) : createD1TextId();
    try {
      await dbRun(
        [
          "insert into weekly_summaries (id, user_id, leader_id, student_name, summary_text,",
          "strategy_text,",
          "strategy_bucket, strategy_path, strategy_name, strategy_mime_type,",
          "curve_text,",
          "curve_bucket, curve_path, curve_name, curve_mime_type,",
          "stats_text,",
          "stats_bucket, stats_path, stats_name, stats_mime_type, created_at, updated_at)",
          "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [
          newId,
          user.id,
          safeLeaderId,
          studentName,
          persistedSummaryText,
          fieldTexts.strategy,
          uploads.strategy?.bucket || "",
          uploads.strategy?.path || "",
          uploads.strategy?.name || null,
          uploads.strategy?.mime || null,
          fieldTexts.curve,
          uploads.curve?.bucket || "",
          uploads.curve?.path || "",
          uploads.curve?.name || null,
          uploads.curve?.mime || null,
          fieldTexts.stats,
          uploads.stats?.bucket || "",
          uploads.stats?.path || "",
          uploads.stats?.name || null,
          uploads.stats?.mime || null,
          now,
          now
        ]
      );
    } catch {
      if (uploaded.length) {
        await removeStoredObjects(admin, uploaded);
      }
      return json({ ok: false, error: "DB_ERROR" }, 500);
    }

    await notifyLeadersAndAdmins(user, {
      title: "周总结提交 / Weekly summary submitted",
      content: buildStudentSubmitContent(user, "提交了周总结。", "submitted a weekly summary.")
    });

    return json({ ok: true, id: newId });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
