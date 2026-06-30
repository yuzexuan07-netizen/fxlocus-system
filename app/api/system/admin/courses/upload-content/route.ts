export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { dbFirst, dbRun } from "@/lib/d1";
import { requireSuperAdmin } from "@/lib/system/guard";
import { normalizeCourseType } from "@/lib/system/courseTypes";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { getR2Bucket, r2Enabled } from "@/lib/storage/r2";
import { uploadBufferToStorage } from "@/lib/storage/storage";
import { createD1TextId } from "@/lib/system/d1Id";
import { buildRequestScopedId, buildRequestScopedPath, normalizeRequestId } from "@/lib/system/uploadIdempotency";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "video/mp4"
]);

const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx", "mp4"]);
const MAX_CONTENT_BYTES = 1024 * 1024 * 1024;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function safeFilename(name: string) {
  return (name || "upload.bin").replace(/[^\w.\-()+\s]/g, "_").slice(0, 120) || "upload.bin";
}

function fileTypeFrom(file: File) {
  const name = String(file.name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  if (ext === "pdf") return "pdf";
  if (ext === "doc") return "doc";
  if (ext === "docx") return "docx";
  if (ext === "mp4") return "mp4";

  const mime = String(file.type || "").toLowerCase();
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("msword")) return "doc";
  if (mime.includes("officedocument")) return "docx";
  if (mime.includes("mp4")) return "mp4";
  return null;
}

function resolveMime(file: File, ext: string) {
  const mime = String(file.type || "").toLowerCase();
  if (mime && mime !== "application/octet-stream") return mime;
  if (ext === "mp4") return "video/mp4";
  if (ext === "pdf") return "application/pdf";
  if (ext === "doc") return "application/msword";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return mime || "application/octet-stream";
}

export async function POST(req: Request) {
  try {
    const { user } = await requireSuperAdmin();
    const storageAdmin = dbAdmin();

    const form = await req.formData().catch(() => null);
    if (!form) return json({ ok: false, error: "INVALID_FORM" }, 400);

    const courseId = Number(form.get("courseId"));
    const requestId = normalizeRequestId(form.get("requestId"));
    if (String(form.get("requestId") || "").trim() && !requestId) {
      return json({ ok: false, error: "INVALID_REQUEST" }, 400);
    }
    const file = form.get("file");
    const qualityRaw = form.get("quality");
    const quality = typeof qualityRaw === "string" ? qualityRaw.trim() : "";
    const titleZhRaw = form.get("title_zh");
    const titleEnRaw = form.get("title_en");
    const summaryZhRaw = form.get("summary_zh");
    const summaryEnRaw = form.get("summary_en");
    const courseTypeRaw = form.get("courseType");
    const sortOrderRaw = form.get("sortOrder");
    const publishedRaw = form.get("published");

    const titleZh = typeof titleZhRaw === "string" ? titleZhRaw.trim().slice(0, 200) : null;
    const titleEn = typeof titleEnRaw === "string" ? titleEnRaw.trim().slice(0, 200) : null;
    const summaryZh = typeof summaryZhRaw === "string" ? summaryZhRaw.trim().slice(0, 800) : null;
    const summaryEn = typeof summaryEnRaw === "string" ? summaryEnRaw.trim().slice(0, 800) : null;
    const courseType = normalizeCourseType(typeof courseTypeRaw === "string" ? courseTypeRaw : null);
    const sortOrder = Number(sortOrderRaw);
    const published =
      typeof publishedRaw === "string" ? publishedRaw === "true" || publishedRaw === "1" : null;

    if (!Number.isInteger(courseId) || courseId < 1) {
      return json({ ok: false, error: "INVALID_COURSE" }, 400);
    }
    if (!(file instanceof File)) return json({ ok: false, error: "MISSING_FILE" }, 400);
    if (file.size > MAX_CONTENT_BYTES) {
      return json({ ok: false, error: "FILE_TOO_LARGE" }, 400);
    }

    const existingCourse = await dbFirst<any>(
      "select content_bucket,content_path,video_variants from courses where id = ? limit 1",
      [courseId]
    );

    const ext = String(file.name || "")
      .toLowerCase()
      .split(".")
      .pop() || "";
    const mime = String(file.type || "").toLowerCase();
    if ((!ext || !ALLOWED_EXTENSIONS.has(ext)) && !ALLOWED_MIME_TYPES.has(mime)) {
      return json({ ok: false, error: "INVALID_FILE_TYPE" }, 400);
    }
    const resolvedMime = resolveMime(file, ext);
    const isVideo = resolvedMime.startsWith("video/") || ext === "mp4";
    if (quality && !isVideo) {
      return json({ ok: false, error: "QUALITY_ONLY_VIDEO" }, 400);
    }

    const bucketCandidates = r2Enabled()
      ? [getR2Bucket()]
      : ([process.env.SYSTEM_FILES_BUCKET, process.env.R2_BUCKET, "fxlocus-system-files"].filter(Boolean) as string[]);
    const now = Date.now();
    const originalName = String(file.name || "").trim();
    const safeName = safeFilename(originalName);
    const displayName = originalName || safeName;
    const path = buildRequestScopedPath(
      `courses/${courseId}`,
      requestId,
      `-${safeName}`,
      () => `courses/${courseId}/${now}-${randomUUID()}-${safeName}`
    );

    const bytes = await file.arrayBuffer();

    let bucketUsed = bucketCandidates[0] || "fxlocus-system-files";
    let uploadError: Error | null = null;
    for (const candidate of bucketCandidates.length ? bucketCandidates : [bucketUsed]) {
      try {
        await uploadBufferToStorage(storageAdmin, candidate, path, bytes, resolvedMime || "application/octet-stream");
        bucketUsed = candidate;
        uploadError = null;
        break;
      } catch (err: any) {
        uploadError = err instanceof Error ? err : new Error(String(err || "UPLOAD_FAILED"));
        if (!/bucket/i.test(uploadError.message)) break;
      }
    }
    if (uploadError) return json({ ok: false, error: uploadError.message }, 500);

    let existingVariants: any[] = [];
    const variantsRaw = existingCourse?.video_variants;
    if (Array.isArray(variantsRaw)) {
      existingVariants = variantsRaw;
    } else if (typeof variantsRaw === "string" && variantsRaw.trim()) {
      try {
        const parsed = JSON.parse(variantsRaw);
        if (Array.isArray(parsed)) existingVariants = parsed;
      } catch {
        // ignore
      }
    }
    const normalizedQuality = String(quality || "").trim();

    const basePayload: any = {
      id: courseId,
      course_type: courseType,
      sort_order: Number.isInteger(sortOrder) && sortOrder > 0 ? sortOrder : courseId,
      updated_at: new Date().toISOString()
    };
    if (typeof titleZh === "string") basePayload.title_zh = titleZh;
    if (typeof titleEn === "string") basePayload.title_en = titleEn;
    if (typeof summaryZh === "string") basePayload.summary_zh = summaryZh;
    if (typeof summaryEn === "string") basePayload.summary_en = summaryEn;
    if (typeof published === "boolean") basePayload.published = published ? 1 : 0;

    if (!normalizedQuality) {
      basePayload.content_bucket = bucketUsed;
      basePayload.content_path = path;
      basePayload.content_mime_type = resolvedMime || null;
      basePayload.content_file_name = displayName;
    } else {
      const norm = (value: any) => String(value || "").trim().toLowerCase();
      const kept = existingVariants.filter((item: any) => norm(item?.label || item?.quality) !== norm(normalizedQuality));
      const nextVariants = [
        ...kept,
        {
          label: normalizedQuality,
          bucket: bucketUsed,
          path,
          mime_type: resolvedMime || null,
          file_name: displayName,
          uploaded_at: new Date().toISOString()
        }
      ];
      basePayload.video_variants = JSON.stringify(nextVariants);

      if (!existingCourse?.content_path) {
        basePayload.content_bucket = bucketUsed;
        basePayload.content_path = path;
        basePayload.content_mime_type = resolvedMime || null;
        basePayload.content_file_name = displayName;
      }
    }

    const columns = Object.keys(basePayload);
    const values = columns.map((key) => basePayload[key]);
    const placeholders = columns.map(() => "?").join(", ");
    const updates = columns
      .filter((key) => key !== "id")
      .map((key) => `${key}=excluded.${key}`)
      .join(", ");
    await dbRun(
      `insert into courses (${columns.join(", ")}) values (${placeholders}) on conflict(id) do update set ${updates}`,
      values
    );

    const uploadFileId = requestId
      ? buildRequestScopedId("coursefile", user.id, courseId, normalizedQuality || "main", requestId)
      : createD1TextId();
    try {
      await dbRun(
        "insert into files (id,category,name,description,storage_bucket,storage_path,size_bytes,mime_type,file_type,course_id,lesson_id,thumbnail_bucket,thumbnail_path,uploaded_by,created_at,updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          uploadFileId,
          "course-content",
          displayName,
          normalizedQuality ? `quality:${normalizedQuality}` : null,
          bucketUsed,
          path,
          file.size,
          resolvedMime || null,
          fileTypeFrom(file),
          courseId,
          courseId,
          null,
          null,
          user.id,
          new Date().toISOString(),
          new Date().toISOString()
        ]
      );
    } catch (err) {
      if (!requestId) throw err;
      const existingFile = await dbFirst<{ id: string }>("select id from files where id = ? limit 1", [uploadFileId]);
      if (!existingFile?.id) throw err;
    }

    const course = await dbFirst<any>("select * from courses where id = ? limit 1", [courseId]);
    return json({ ok: true, course });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
