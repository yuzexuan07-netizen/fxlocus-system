export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { requireAdmin } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { getR2Bucket, r2Enabled } from "@/lib/storage/r2";
import { removeStoredObjects, uploadBufferToStorage } from "@/lib/storage/storage";
import { createD1TextId } from "@/lib/system/d1Id";
import { buildRequestScopedId, buildRequestScopedPath, normalizeRequestId } from "@/lib/system/uploadIdempotency";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "video/mp4",
  "application/zip",
  "application/x-zip-compressed",
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

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "mp4",
  "ex4",
  "zip",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "avif",
  "heic",
  "heif",
  "jfif"
]);
const MAX_FILE_BYTES = 1024 * 1024 * 1024;

function fileTypeFrom(file: File) {
  const name = String(file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  if (ext === "pdf") return "pdf";
  if (ext === "doc") return "doc";
  if (ext === "docx") return "docx";
  if (ext === "mp4") return "mp4";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "heic", "heif", "jfif"].includes(ext)) {
    return "image";
  }

  const mime = String(file.type || "").toLowerCase();
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("msword")) return "doc";
  if (mime.includes("officedocument")) return "docx";
  if (mime.includes("mp4")) return "mp4";
  if (mime.startsWith("image/")) return "image";
  return null;
}

function safeSegment(input: string) {
  const s = (input || "").trim().toLowerCase();
  const cleaned = s.replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "misc";
}

function safeFileName(name: string) {
  const base = (name || "").trim();
  const idx = base.lastIndexOf(".");
  const ext = idx >= 0 ? base.slice(idx).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  const stem = idx >= 0 ? base.slice(0, idx) : base;

  const safeStem = stem
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return (safeStem || "file") + (ext || "");
}

function extFromMime(mimeType: string) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("msword")) return ".doc";
  if (mime.includes("officedocument.wordprocessingml.document")) return ".docx";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("zip")) return ".zip";
  if (mime.includes("png")) return ".png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("bmp")) return ".bmp";
  if (mime.includes("avif")) return ".avif";
  if (mime.includes("heic")) return ".heic";
  if (mime.includes("heif")) return ".heif";
  return "";
}

function ensureDisplayNameWithExtension(displayName: string, originalName: string, mimeType: string) {
  const cleaned = String(displayName || "").trim();
  if (!cleaned) return "";
  if (/\.[a-z0-9]{1,12}$/i.test(cleaned)) return cleaned;

  const sourceExt =
    (String(originalName || "").trim().match(/(\.[a-z0-9]{1,12})$/i)?.[1] || "").toLowerCase() ||
    extFromMime(mimeType);
  if (!sourceExt) return cleaned;
  return `${cleaned}${sourceExt}`;
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAdmin();
    const admin = dbAdmin();

    const form = await req.formData();
    const requestId = normalizeRequestId(form.get("requestId"));
    if (String(form.get("requestId") || "").trim() && !requestId) {
      return NextResponse.json({ ok: false, error: "INVALID_REQUEST" }, { status: 400 });
    }
    const file = form.get("file");
    const category = String(form.get("category") || "misc");
    const displayName = String(form.get("name") || "");
    const description = String(form.get("description") || "");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "MISSING_FILE" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ ok: false, error: "FILE_TOO_LARGE" }, { status: 400 });
    }

    const ext = String(file.name || "")
      .toLowerCase()
      .split(".")
      .pop();
    const mime = String(file.type || "").toLowerCase();
    if ((!ext || !ALLOWED_EXTENSIONS.has(ext)) && !ALLOWED_MIME_TYPES.has(mime)) {
      return NextResponse.json({ ok: false, error: "INVALID_FILE_TYPE" }, { status: 400 });
    }

    const bucketCandidates = r2Enabled()
      ? [getR2Bucket()]
      : ([process.env.SYSTEM_FILES_BUCKET, process.env.R2_BUCKET, "fxlocus-system-files"].filter(Boolean) as string[]);

    const folder = safeSegment(String(form.get("folder") || category));
    const originalName = String(file.name || "").trim();
    const safeName = safeFileName(originalName || "upload.bin");
    const displayNameWithExt = ensureDisplayNameWithExtension(displayName, originalName, file.type || "");
    const finalName = displayNameWithExt || originalName || safeName;
    const path = buildRequestScopedPath(
      folder,
      requestId,
      `-${safeName}`,
      () => `${folder}/${Date.now()}-${randomUUID()}-${safeName}`
    );
    if (path.startsWith("/") || path.includes("..") || path.includes("//")) {
      return NextResponse.json({ ok: false, error: "INVALID_KEY" }, { status: 400 });
    }

    const buf = await file.arrayBuffer();

    let bucketUsed = bucketCandidates[0] || "fxlocus-system-files";
    let uploadError: Error | null = null;

    for (const candidate of bucketCandidates.length ? bucketCandidates : [bucketUsed]) {
      try {
        await uploadBufferToStorage(admin, candidate, path, buf, file.type || "application/octet-stream");
        bucketUsed = candidate;
        uploadError = null;
        break;
      } catch (err: any) {
        uploadError = err instanceof Error ? err : new Error(String(err || "UPLOAD_FAILED"));
        if (!/bucket/i.test(uploadError.message)) break;
      }
    }

    if (uploadError) {
      console.error("[files/upload] storage upload error:", uploadError);
      return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });
    }

    const fileId = requestId ? buildRequestScopedId("file", user.id, folder, requestId) : createD1TextId();
    const ins = await admin
      .from("files")
      .insert({
        id: fileId,
        category: folder,
        name: finalName,
        description: description.trim() || null,
        storage_bucket: bucketUsed,
        storage_path: path,
        size_bytes: file.size,
        mime_type: file.type || null,
        file_type: fileTypeFrom(file),
        uploaded_by: user.id
      })
      .select("*")
      .single();

    if (ins.error) {
      if (requestId) {
        const existing = await admin.from("files").select("*").eq("id", fileId).maybeSingle();
        if (existing.data?.id) {
          return NextResponse.json(
            { ok: true, file: existing.data, duplicated: true },
            { headers: { "Cache-Control": "no-store" } }
          );
        }
      }
      console.error("[files/upload] db insert error:", ins.error);
      await removeStoredObjects(admin, [{ bucket: bucketUsed, path }]);
      return NextResponse.json({ ok: false, error: ins.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, file: ins.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[files/upload] fatal:", e);
    return NextResponse.json({ ok: false, error: e?.message || "UPLOAD_FAILED" }, { status: 500 });
  }
}
