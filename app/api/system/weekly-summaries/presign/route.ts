import { NextRequest, NextResponse } from "next/server";
import { requireLearner } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { getR2Bucket, r2Enabled } from "@/lib/storage/r2";
import { createSignedUploadUrl } from "@/lib/storage/storage";
import { dbFirst } from "@/lib/d1";
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

type PresignFile = {
  key?: "strategy" | "curve" | "stats";
  name?: string;
  size?: number;
  type?: string;
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

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireLearner();
    const payload = await req.json().catch(() => null);
    const rawFiles = Array.isArray(payload?.files) ? (payload.files as PresignFile[]) : [];
    if (!rawFiles.length) return json({ ok: false, error: "MISSING_FILES" }, 400);
    if (rawFiles.length > 3) return json({ ok: false, error: "TOO_MANY_FILES" }, 400);

    const entryIdRaw = typeof payload?.entryId === "string" ? payload.entryId.trim() : "";
    const requestId = normalizeRequestId(payload?.requestId);
    if (entryIdRaw.length > 128) return json({ ok: false, error: "INVALID_ENTRY" }, 400);
    const entryId = entryIdRaw || (requestId ? buildRequestScopedId("weekly", user.id, requestId) : createD1TextId());

    const allowedKeys = new Set(["strategy", "curve", "stats"]);
    const keys = rawFiles.map((f) => f.key).filter(Boolean) as Array<"strategy" | "curve" | "stats">;
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) return json({ ok: false, error: "INVALID_FILES" }, 400);
    if (keys.some((key) => !allowedKeys.has(key))) return json({ ok: false, error: "INVALID_FILES" }, 400);
    const admin = dbAdmin();

    if (entryIdRaw) {
      const existing = await dbFirst<{ id: string; user_id: string }>(
        "select id, user_id from weekly_summaries where id = ? limit 1",
        [entryId]
      );
      if (!existing?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
      if (existing.user_id !== user.id) return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const bucketCandidates = r2Enabled()
      ? [getR2Bucket()]
      : ([
          process.env.SYSTEM_WEEKLY_SUMMARIES_BUCKET,
          "fxlocus_weekly_summaries",
          "fxlocus-weekly-summaries"
        ].filter(Boolean) as string[]);
    if (!bucketCandidates.length) bucketCandidates.push("fxlocus_weekly_summaries");

    const uploads: Array<{
      key: "strategy" | "curve" | "stats";
      bucket: string;
      path: string;
      token?: string | null;
      uploadUrl?: string | null;
      fileName: string;
      mimeType: string | null;
      size: number;
    }> = [];

    for (const file of rawFiles) {
      const key = file.key;
      if (!key) return json({ ok: false, error: "INVALID_FILES" }, 400);
      const originalName = String(file.name || "").trim();
      const safeName = safeFilename(originalName, `${key}.bin`);
      const displayName = originalName || safeName;
      const mimeType = file.type ? String(file.type) : null;
      const size = Number(file.size || 0);
      if (size > MAX_BYTES) return json({ ok: false, error: "FILE_TOO_LARGE" }, 400);
      if (!isAllowedMeta(displayName, mimeType)) {
        return json({ ok: false, error: "INVALID_FILE_TYPE" }, 400);
      }

      const path = requestId
        ? `weekly-summaries/${user.id}/${entryId}/${key}-${safeName}`
        : `weekly-summaries/${user.id}/${entryId}/${Date.now()}-${key}-${safeName}`;

      const bucketUsed = bucketCandidates[0];
      const signed = await createSignedUploadUrl(
        admin,
        bucketUsed,
        path,
        mimeType || "application/octet-stream",
        3600
      );
      if (!signed.uploadUrl && !signed.token) {
        return json({ ok: false, error: "SIGNED_URL_FAILED" }, 500);
      }

      uploads.push({
        key,
        bucket: bucketUsed,
        path,
        token: signed.token,
        uploadUrl: signed.uploadUrl,
        fileName: displayName,
        mimeType,
        size
      });
    }

    return json({ ok: true, entryId, uploads });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
