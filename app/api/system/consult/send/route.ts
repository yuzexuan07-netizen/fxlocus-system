import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { canConsultWith } from "@/lib/system/consult";
import { requireSystemUser } from "@/lib/system/guard";
import { dbFirst, dbRun } from "@/lib/d1";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { getR2Bucket, r2Enabled } from "@/lib/storage/r2";
import { removeStoredObjects, uploadBufferToStorage } from "@/lib/storage/storage";
import { invalidateConsultCache } from "@/lib/system/cacheInvalidation";
import { isMissingSchemaError } from "@/lib/system/schema";
import { buildRequestScopedId, buildRequestScopedPath, normalizeRequestId } from "@/lib/system/uploadIdempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "webm",
  "m4a",
  "mp3",
  "wav",
  "ogg",
  "aac",
  "mp4"
]);
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/aac",
  "audio/x-m4a",
  "audio/m4a"
]);
const MAX_BYTES = 24 * 1024 * 1024;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function safeFilename(name: string, fallback = "file.bin") {
  return (name || fallback).replace(/[^\w.\-()+\s]/g, "_").slice(0, 120) || fallback;
}

function isAllowed(file: File) {
  const name = String(file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  const mime = normalizeContentType(file.type);
  return ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIME_TYPES.has(mime);
}

function normalizeContentType(value: unknown) {
  const mime = String(value || "").trim().toLowerCase().split(";")[0] || "";
  if (mime === "audio/x-m4a" || mime === "audio/m4a") return "audio/mp4";
  if (mime === "audio/x-wav") return "audio/wav";
  if (mime) return mime;
  return "";
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function uploadBufferWithRetry(
  admin: ReturnType<typeof dbAdmin>,
  bucket: string,
  path: string,
  bytes: ArrayBuffer,
  contentType: string
) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await uploadBufferToStorage(admin, bucket, path, bytes, contentType);
      return;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err || "UPLOAD_FAILED"));
      if (/bucket/i.test(lastError.message)) throw lastError;
      if (attempt < 2) {
        await wait(220 * (attempt + 1));
      }
    }
  }
  throw lastError || new Error("UPLOAD_FAILED");
}

export async function POST(req: Request) {
  try {
    const ctx = await requireSystemUser();
    const form = await req.formData().catch(() => null);
    if (!form) return json({ ok: false, error: "INVALID_FORM" }, 400);

    const toUserId = String(form.get("toUserId") || "").trim();
    if (!toUserId || toUserId.length > 128) return json({ ok: false, error: "INVALID_PEER" }, 400);
    const requestId = normalizeRequestId(form.get("requestId"));
    if (String(form.get("requestId") || "").trim() && !requestId) {
      return json({ ok: false, error: "INVALID_REQUEST" }, 400);
    }
    const replyToMessageId = String(form.get("replyToMessageId") || "").trim();
    if (replyToMessageId && replyToMessageId.length > 128) {
      return json({ ok: false, error: "INVALID_REPLY_TARGET" }, 400);
    }

    const textRaw = form.get("text");
    const text = typeof textRaw === "string" ? textRaw.trim().slice(0, 2000) : "";
    const audioDurationSecRaw = Number(form.get("audioDurationSec") || 0);
    const audioDurationSec =
      Number.isFinite(audioDurationSecRaw) && audioDurationSecRaw > 0 && audioDurationSecRaw <= 2 * 60 + 1
        ? Math.round(audioDurationSecRaw * 100) / 100
        : null;

    const imageRaw = form.get("image");
    const audioRaw = form.get("audio");
    const file = imageRaw instanceof File ? imageRaw : audioRaw instanceof File ? audioRaw : null;
    const attachmentKind = audioRaw instanceof File ? "audio" : imageRaw instanceof File ? "image" : null;
    if (!text && !file) return json({ ok: false, error: "EMPTY_MESSAGE" }, 400);

    if (file) {
      if (!isAllowed(file)) return json({ ok: false, error: "INVALID_FILE_TYPE" }, 400);
      if (file.size > MAX_BYTES) return json({ ok: false, error: "FILE_TOO_LARGE" }, 400);
    }

    const allowed = await canConsultWith(ctx, toUserId);
    if (!allowed) return json({ ok: false, error: "FORBIDDEN" }, 403);

    if (replyToMessageId) {
      const target = await dbFirst<{ id: string; from_user_id: string; to_user_id: string }>(
        "select id, from_user_id, to_user_id from consult_messages where id = ? limit 1",
        [replyToMessageId]
      );
      const isPairMessage =
        Boolean(target?.id) &&
        ((target?.from_user_id === ctx.user.id && target?.to_user_id === toUserId) ||
          (target?.from_user_id === toUserId && target?.to_user_id === ctx.user.id));
      if (!isPairMessage) return json({ ok: false, error: "INVALID_REPLY_TARGET" }, 400);
    }

    const messageId = requestId ? buildRequestScopedId("consult", ctx.user.id, toUserId, requestId) : "";

    const admin = dbAdmin();
    let imagePayload: {
      bucket?: string;
      path?: string;
      name?: string;
      mime?: string | null;
      size?: number;
    } = {};

    if (file) {
      const bucketCandidates = [
        process.env.SYSTEM_CONSULT_BUCKET,
        "fxlocus_consult",
        "fxlocus-consult"
      ].filter(Boolean) as string[];
      const resolvedCandidates = r2Enabled() ? [getR2Bucket()] : bucketCandidates;
      if (!resolvedCandidates.length) resolvedCandidates.push("fxlocus_consult");

      const safeName = safeFilename(
        file.name || (attachmentKind === "audio" ? "voice-message.webm" : "image.png"),
        attachmentKind === "audio" ? "voice-message.webm" : "image.png"
      );
      const path = buildRequestScopedPath(
        attachmentKind === "audio" ? `consult/audio/${ctx.user.id}` : `consult/images/${ctx.user.id}`,
        requestId,
        `-${safeName}`,
        () =>
          `${
            attachmentKind === "audio" ? `consult/audio/${ctx.user.id}` : `consult/images/${ctx.user.id}`
          }/${Date.now()}-${randomUUID()}-${safeName}`
      );
      const bytes = await file.arrayBuffer();

      let bucketUsed = resolvedCandidates[0];
      let uploadError: Error | null = null;
      const uploadContentType =
        normalizeContentType(file.type) || (attachmentKind === "audio" ? "audio/webm" : "image/png");
      for (const candidate of resolvedCandidates) {
        try {
          await uploadBufferWithRetry(admin, candidate, path, bytes, uploadContentType);
          bucketUsed = candidate;
          uploadError = null;
          break;
        } catch (err: any) {
          uploadError = err instanceof Error ? err : new Error(String(err || "UPLOAD_FAILED"));
          if (!/bucket/i.test(uploadError.message)) break;
        }
      }

      if (uploadError) return json({ ok: false, error: "UPLOAD_FAILED" }, 500);

      imagePayload = {
        bucket: bucketUsed,
        path,
        name: file.name || safeName,
        mime: uploadContentType || file.type || null,
        size: file.size
      };
    }

    const contentType = file
      ? attachmentKind === "audio"
        ? "audio"
        : text
          ? "mixed"
          : "image"
      : "text";
    const createdAt = new Date().toISOString();
    try {
      try {
        const insertColumns = messageId
          ? "id, from_user_id, to_user_id, content_type, content_text, image_bucket, image_path, image_name, image_mime_type, image_size_bytes, audio_duration_sec, reply_to_message_id, created_at"
          : "from_user_id, to_user_id, content_type, content_text, image_bucket, image_path, image_name, image_mime_type, image_size_bytes, audio_duration_sec, reply_to_message_id, created_at";
        const insertValues = messageId
          ? "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?"
          : "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
        await dbRun(
          [
            `insert into consult_messages (${insertColumns})`,
            `values (${insertValues})`
          ].join(" "),
          [
            ...(messageId ? [messageId] : []),
            ctx.user.id,
            toUserId,
            contentType,
            text || null,
            imagePayload.bucket ?? null,
            imagePayload.path ?? null,
            imagePayload.name ?? null,
            imagePayload.mime ?? null,
            imagePayload.size ?? null,
            contentType === "audio" ? audioDurationSec : null,
            replyToMessageId || null,
            createdAt
          ]
        );
      } catch (insertErr) {
        if (!isMissingSchemaError(insertErr)) throw insertErr;
        const insertColumns = messageId
          ? "id, from_user_id, to_user_id, content_type, content_text, image_bucket, image_path, image_name, image_mime_type, image_size_bytes, created_at"
          : "from_user_id, to_user_id, content_type, content_text, image_bucket, image_path, image_name, image_mime_type, image_size_bytes, created_at";
        const insertValues = messageId
          ? "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?"
          : "?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
        await dbRun(
          [
            `insert into consult_messages (${insertColumns})`,
            `values (${insertValues})`
          ].join(" "),
          [
            ...(messageId ? [messageId] : []),
            ctx.user.id,
            toUserId,
            contentType,
            text || null,
            imagePayload.bucket ?? null,
            imagePayload.path ?? null,
            imagePayload.name ?? null,
            imagePayload.mime ?? null,
            imagePayload.size ?? null,
            createdAt
          ]
        );
      }
    } catch (err) {
      if (messageId) {
        const existing = await dbFirst<{ id: string }>("select id from consult_messages where id = ? limit 1", [messageId]);
        if (existing?.id) {
          invalidateConsultCache();
          return json({ ok: true, duplicated: true });
        }
      }
      if (imagePayload.bucket && imagePayload.path) {
        await removeStoredObjects(admin, [{ bucket: imagePayload.bucket, path: imagePayload.path }]);
      }
      return json({ ok: false, error: "DB_INSERT_FAILED" }, 500);
    }

    invalidateConsultCache();
    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
