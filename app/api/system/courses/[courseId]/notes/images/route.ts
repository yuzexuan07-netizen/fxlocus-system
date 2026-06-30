import { randomUUID } from "crypto";
import { extname } from "path";
import { NextRequest, NextResponse } from "next/server";

import { buildStorageProxyUrl } from "@/lib/storage/objectUrl";
import { getR2Bucket, r2Enabled } from "@/lib/storage/r2";
import { uploadBufferToStorage } from "@/lib/storage/storage";
import { mapSystemApiError } from "@/lib/system/apiError";
import { ensureCourseProgressAccess } from "@/lib/system/courseAuthorization.server";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { requireLearner } from "@/lib/system/guard";
import { buildRequestScopedPath, normalizeRequestId } from "@/lib/system/uploadIdempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const ALLOWED_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function parseCourseId(raw: string | undefined) {
  const value = Number(raw || "");
  if (!Number.isInteger(value) || value < 1 || value > 5000) return null;
  return value;
}

function normalizeExtension(file: File) {
  const byName = extname(String(file.name || "").toLowerCase());
  if (ALLOWED_EXTS.has(byName)) return byName;

  const mime = String(file.type || "").toLowerCase();
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return "";
}

function isAllowedImage(file: File) {
  const mime = String(file.type || "").toLowerCase();
  const ext = extname(String(file.name || "").toLowerCase());
  return ALLOWED_MIME_TYPES.has(mime) || ALLOWED_EXTS.has(ext);
}

async function resolveUploadBucket(admin: ReturnType<typeof dbAdmin>) {
  const candidates = r2Enabled()
    ? [getR2Bucket()]
    : ([
        process.env.SYSTEM_SUMMARY_IMAGES_BUCKET,
        "fxlocus_course_summaries",
        "fxlocus-course-summaries",
        process.env.R2_BUCKET
      ].filter(Boolean) as string[]);

  if (!candidates.length) return null;

  for (const bucket of candidates) {
    try {
      const probe = await admin.storage.from(bucket).createSignedUploadUrl(`course-notes/_probe/${Date.now()}`);
      if (!probe.error) return bucket;
      const message = String(probe.error.message || "");
      if (/not found|bucket/i.test(message)) continue;
      return bucket;
    } catch {
      continue;
    }
  }

  return candidates[0] || null;
}

export async function POST(req: NextRequest, context: { params: { courseId: string } }) {
  try {
    const { user } = await requireLearner();
    const courseId = parseCourseId(context.params?.courseId);
    if (!courseId) return json({ ok: false, error: "INVALID_COURSE" }, 400);

    const { state, access } = await ensureCourseProgressAccess(user.id, courseId);
    if (!state.course) return json({ ok: false, error: "INVALID_COURSE" }, 400);
    if (!access) return json({ ok: false, error: "NO_ACCESS" }, 403);
    if (access.status !== "approved" && access.status !== "completed") {
      return json({ ok: false, error: "NOT_APPROVED" }, 403);
    }

    const form = await req.formData().catch(() => null);
    if (!form) return json({ ok: false, error: "INVALID_FORM" }, 400);

    const raw = form.get("file");
    const requestId = normalizeRequestId(form.get("requestId"));
    if (String(form.get("requestId") || "").trim() && !requestId) {
      return json({ ok: false, error: "INVALID_REQUEST" }, 400);
    }
    const file = raw instanceof File ? raw : null;
    if (!file) return json({ ok: false, error: "MISSING_FILE" }, 400);
    if (!isAllowedImage(file)) return json({ ok: false, error: "INVALID_FILE_TYPE" }, 400);
    if (file.size > MAX_IMAGE_BYTES) return json({ ok: false, error: "FILE_TOO_LARGE" }, 400);

    const ext = normalizeExtension(file);
    if (!ext) return json({ ok: false, error: "INVALID_FILE_TYPE" }, 400);

    const admin = dbAdmin();
    const bucket = await resolveUploadBucket(admin);
    if (!bucket) return json({ ok: false, error: "BUCKET_NOT_FOUND" }, 500);

    const key = buildRequestScopedPath(
      `course-notes/${user.id}/${courseId}`,
      requestId,
      ext,
      () => `course-notes/${user.id}/${courseId}/${Date.now()}-${randomUUID()}${ext}`
    );
    const bytes = await file.arrayBuffer();
    await uploadBufferToStorage(admin, bucket, key, bytes, file.type || "application/octet-stream");

    return json({
      ok: true,
      bucket,
      path: key,
      url: buildStorageProxyUrl(bucket, key)
    });
  } catch (error) {
    const mapped = mapSystemApiError(error);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}

