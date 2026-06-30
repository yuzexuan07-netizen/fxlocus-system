import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { requireLearner } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { buildStudentSubmitContent, notifyLeadersAndAdmins } from "@/lib/system/notify";
import { resolveExistingProfileId } from "@/lib/system/profileRefs";
import { dbFirst, dbRun } from "@/lib/d1";
import { getR2Bucket, r2Enabled } from "@/lib/storage/r2";
import { removeStoredObjects, uploadBufferToStorage } from "@/lib/storage/storage";
import { createD1TextId } from "@/lib/system/d1Id";
import { buildRequestScopedId, buildRequestScopedPath, normalizeRequestId } from "@/lib/system/uploadIdempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "heic", "heif", "jfif"]);
const ALLOWED_MIME_TYPES = new Set([
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
const MAX_BYTES = 5 * 1024 * 1024;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function safeFilename(name: string) {
  return (name || "image.png").replace(/[^\w.\-()+\s]/g, "_").slice(0, 120) || "image.png";
}

function isAllowed(file: File) {
  const name = String(file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  const mime = String(file.type || "").toLowerCase();
  return mime.startsWith("image/") || ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIME_TYPES.has(mime);
}

export async function POST(req: Request) {
  try {
    const { user } = await requireLearner();
    const safeLeaderId = await resolveExistingProfileId(user.leader_id);
    const actorForNotify = { ...user, leader_id: safeLeaderId };
    const form = await req.formData().catch(() => null);
    if (!form) return json({ ok: false, error: "INVALID_FORM" }, 400);

    const reasonRaw = form.get("reason");
    const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
    if (!reason) return json({ ok: false, error: "MISSING_REASON" }, 400);
    const requestId = normalizeRequestId(form.get("requestId"));
    if (String(form.get("requestId") || "").trim() && !requestId) {
      return json({ ok: false, error: "INVALID_REQUEST" }, 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) return json({ ok: false, error: "MISSING_FILE" }, 400);
    if (!isAllowed(file)) return json({ ok: false, error: "INVALID_FILE_TYPE" }, 400);
    if (file.size > MAX_BYTES) return json({ ok: false, error: "FILE_TOO_LARGE" }, 400);

    const entryIdRaw = form.get("entryId");
    const entryId = typeof entryIdRaw === "string" ? entryIdRaw.trim() : "";
    if (entryId.length > 128) return json({ ok: false, error: "INVALID_ENTRY" }, 400);

    const admin = dbAdmin();
    const now = new Date().toISOString();
    let oldFile: { bucket: string; path: string } | null = null;

    if (entryId) {
      const existing = await dbFirst<{
        id: string;
        user_id: string;
        image_bucket: string | null;
        image_path: string | null;
      }>(
        "select id,user_id,image_bucket,image_path from classic_trades where id = ? limit 1",
        [entryId]
      );
      if (!existing?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
      if (existing.user_id !== user.id) return json({ ok: false, error: "FORBIDDEN" }, 403);
      if (existing.image_bucket && existing.image_path) {
        oldFile = { bucket: existing.image_bucket, path: existing.image_path };
      }
    }

    const bucketCandidates = r2Enabled()
      ? [getR2Bucket()]
      : ([process.env.SYSTEM_CLASSIC_TRADES_BUCKET, process.env.R2_BUCKET, "fxlocus-system-files"].filter(
          Boolean
        ) as string[]);
    const bucket = bucketCandidates[0] || "fxlocus-system-files";
    const safeName = safeFilename(file.name || "image.png");
    const path = buildRequestScopedPath(
      `classic-trades/${user.id}`,
      requestId,
      `-${safeName}`,
      () => `classic-trades/${user.id}/${Date.now()}-${randomUUID()}-${safeName}`
    );
    const bytes = await file.arrayBuffer();

    let bucketUsed = bucket;
    let uploadError: Error | null = null;
    for (const candidate of bucketCandidates.length ? bucketCandidates : [bucket]) {
      try {
        await uploadBufferToStorage(admin, candidate, path, bytes, file.type || "image/png");
        bucketUsed = candidate;
        uploadError = null;
        break;
      } catch (err: any) {
        uploadError = err instanceof Error ? err : new Error(String(err || "UPLOAD_FAILED"));
        if (!/bucket/i.test(uploadError.message)) break;
      }
    }
    if (uploadError) return json({ ok: false, error: "UPLOAD_FAILED" }, 500);

    if (entryId) {
      try {
        await dbRun(
          [
            "update classic_trades set reason = ?, leader_id = ?, image_bucket = ?, image_path = ?,",
            "image_name = ?, image_mime_type = ?, reviewed_at = null, reviewed_by = null,",
            "review_note = null, updated_at = ? where id = ?"
          ].join(" "),
          [
            reason,
            safeLeaderId,
            bucketUsed,
            path,
            file.name || safeName,
            file.type || null,
            now,
            entryId
          ]
        );
      } catch {
        await removeStoredObjects(admin, [{ bucket: bucketUsed, path }]);
        return json({ ok: false, error: "DB_ERROR" }, 500);
      }

      if (oldFile) {
        await removeStoredObjects(admin, [oldFile]);
      }

      await notifyLeadersAndAdmins(actorForNotify, {
        title: "模拟交易案例提交 / Simulation trade case submitted",
        content: buildStudentSubmitContent(user, "更新了模拟交易案例。", "updated a simulation trade case.")
      });

      return json({ ok: true, id: entryId });
    }

    const newId = requestId ? buildRequestScopedId("classictrade", user.id, requestId) : createD1TextId();
    try {
      await dbRun(
        [
          "insert into classic_trades",
          "(id, user_id, leader_id, reason, image_bucket, image_path, image_name, image_mime_type, created_at, updated_at)",
          "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [
          newId,
          user.id,
          safeLeaderId,
          reason,
          bucketUsed,
          path,
          file.name || safeName,
          file.type || null,
          now,
          now
        ]
      );
    } catch {
      if (requestId) {
        const existing = await dbFirst<{ id: string }>("select id from classic_trades where id = ? and user_id = ? limit 1", [
          newId,
          user.id
        ]);
        if (existing?.id) return json({ ok: true, id: existing.id, duplicated: true });
      }
      await removeStoredObjects(admin, [{ bucket: bucketUsed, path }]);
      return json({ ok: false, error: "DB_ERROR" }, 500);
    }

    await notifyLeadersAndAdmins(actorForNotify, {
      title: "模拟交易案例提交 / Simulation trade case submitted",
      content: buildStudentSubmitContent(user, "提交了模拟交易案例。", "submitted a simulation trade case.")
    });

    return json({ ok: true, id: newId });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
