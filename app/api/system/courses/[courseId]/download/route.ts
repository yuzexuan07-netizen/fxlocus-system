import { NextRequest, NextResponse } from "next/server";

import { dbFirst } from "@/lib/d1";
import { createSignedDownloadUrl } from "@/lib/storage/storage";
import { ensureDownloadFilename } from "@/lib/storage/filename";
import { mapSystemApiError } from "@/lib/system/apiError";
import { getCourseAuthorizationState } from "@/lib/system/courseAuthorization.server";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { requireSystemUser } from "@/lib/system/guard";
import { isAdminRole } from "@/lib/system/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CourseRow = {
  id: number;
  content_bucket: string | null;
  content_path: string | null;
  content_file_name: string | null;
  content_mime_type: string | null;
  published: number | string | boolean | null;
  deleted_at: string | null;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function parseCourseId(raw: string | undefined) {
  const id = Number(raw || "");
  if (!Number.isInteger(id) || id < 1 || id > 5000) return null;
  return id;
}

function normalizePublished(value: CourseRow["published"]) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return !["0", "false", "f", "no", "n"].includes(lower);
  }
  return false;
}

async function resolveDownload(courseId: number) {
  const { user } = await requireSystemUser();

  const course = await dbFirst<CourseRow>(
    "select id, content_bucket, content_path, content_file_name, content_mime_type, published, deleted_at from courses where id = ? limit 1",
    [courseId]
  );
  if (!course?.id) return { error: "NOT_FOUND" as const };
  if (!course.content_bucket || !course.content_path) return { error: "MISSING_CONTENT" as const };

  const isAdmin = isAdminRole(user.role);
  let canDownload = isAdmin;

  if (!canDownload) {
    const authState = await getCourseAuthorizationState(user.id, courseId);
    canDownload = authState.canView;
  }

  if (!canDownload) {
    const published = normalizePublished(course.published) && !course.deleted_at;
    if (!published) return { error: "FORBIDDEN" as const };
    // Keep strict behavior for learners: published alone is not enough.
    return { error: "FORBIDDEN" as const };
  }

  const fileName = ensureDownloadFilename(
    course.content_file_name,
    course.content_path,
    course.content_mime_type,
    `course-${courseId}`
  );
  const signedUrl = await createSignedDownloadUrl(dbAdmin(), course.content_bucket, course.content_path, 3600, {
    disposition: "attachment",
    filename: fileName,
    contentType: course.content_mime_type
  });
  if (!signedUrl) return { error: "SIGN_FAILED" as const };

  return {
    ok: true as const,
    url: signedUrl,
    fileName,
    mimeType: course.content_mime_type || null
  };
}

function toErrorStatus(error: string | undefined) {
  if (error === "NOT_FOUND") return 404;
  if (error === "FORBIDDEN") return 403;
  if (error === "MISSING_CONTENT") return 404;
  if (error === "SIGN_FAILED") return 500;
  return 400;
}

export async function GET(req: NextRequest, context: { params: { courseId: string } }) {
  try {
    const courseId = parseCourseId(context.params?.courseId);
    if (!courseId) return json({ ok: false, error: "INVALID_COURSE" }, 400);

    const resolved = await resolveDownload(courseId);
    if ("error" in resolved) {
      return json({ ok: false, error: resolved.error }, toErrorStatus(resolved.error));
    }

    const mode = String(req.nextUrl.searchParams.get("mode") || "").toLowerCase();
    if (mode === "json") {
      return json({
        ok: true,
        url: resolved.url,
        file_name: resolved.fileName,
        mime_type: resolved.mimeType
      });
    }

    return NextResponse.redirect(resolved.url, 302);
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}

export async function POST(_req: NextRequest, context: { params: { courseId: string } }) {
  try {
    const courseId = parseCourseId(context.params?.courseId);
    if (!courseId) return json({ ok: false, error: "INVALID_COURSE" }, 400);

    const resolved = await resolveDownload(courseId);
    if ("error" in resolved) {
      return json({ ok: false, error: resolved.error }, toErrorStatus(resolved.error));
    }

    return json({
      ok: true,
      url: resolved.url,
      file_name: resolved.fileName,
      mime_type: resolved.mimeType
    });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
