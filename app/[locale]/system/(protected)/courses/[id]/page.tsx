import { unstable_noStore } from "next/cache";
import { redirect } from "next/navigation";

import { CourseAccessGateClient } from "@/components/system/CourseAccessGateClient";
import { CoursePlayerClient } from "@/components/system/CoursePlayerClient";
import { dbAll, dbFirst } from "@/lib/d1";
import { getSystemAuth } from "@/lib/system/auth";
import { getCourseAuthorizationState } from "@/lib/system/courseAuthorization.server";
import { getCourseRequestBlockMessage } from "@/lib/system/courseAccessRules";
import { getCourseRequestBlockState } from "@/lib/system/courseAccessRules.server";
import { getCourseTypeLabel } from "@/lib/system/courseTypes";
import { getCourseDisplayCode, getCourseDisplayTitle } from "@/lib/system/courseDisplay";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { rewriteHtmlStorageUrlsToProxy } from "@/lib/storage/objectUrl";
import { createSignedDownloadUrl } from "@/lib/storage/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CoursePage({
  params
}: {
  params: { locale: "zh" | "en"; id: string };
}) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const courseId = Number(params.id);
  if (!Number.isInteger(courseId) || courseId < 1 || courseId > 5000) {
    redirect(`/${locale}/system/courses`);
  }

  const auth = await getSystemAuth();
  if (!auth.ok) return null;

  const storageAdmin = dbAdmin();

  const authState = await getCourseAuthorizationState(auth.user.id, courseId);
  const course = authState.course;

  if (!course) redirect(`/${locale}/system/courses`);
  const [note, blockState, courseList] = await Promise.all([
    dbFirst("select * from course_notes where user_id = ? and course_id = ? limit 1", [auth.user.id, courseId]),
    authState.usesGroupAccess ? Promise.resolve({ code: null }) : getCourseRequestBlockState(auth.user.id, courseId),
    dbAll<{ id: number; title_zh: string | null; title_en: string | null; sort_order: number | null }>(
      [
        "select id, title_zh, title_en, sort_order from courses",
        "where coalesce(course_type, 'advanced') = ? and deleted_at is null",
        "order by coalesce(sort_order, id) asc, id asc"
      ].join(" "),
      [authState.courseType]
    )
  ]);
  const summaryHtml = rewriteHtmlStorageUrlsToProxy(String((note as any)?.content_html || ""));
  const displayTitle = getCourseDisplayTitle(locale, {
    id: courseId,
    title_zh: (course as any)?.title_zh || null,
    title_en: (course as any)?.title_en || null
  });
  const displayCode = getCourseDisplayCode(locale, courseId);

  const access = authState.access;
  const status = authState.status;
  const canView = authState.canView;

  if (!canView) {
    if (authState.usesGroupAccess) {
      return (
        <div className="space-y-6 max-w-[900px]">
          <div className="rounded-3xl border border-amber-300/20 bg-amber-400/10 p-6">
            <div className="text-white/90 font-semibold text-xl">{displayTitle}</div>
            <div className="mt-1 text-xs text-white/45">{getCourseTypeLabel(authState.courseType, locale)}</div>
            <div className="mt-3 text-sm leading-6 text-amber-100/80">
              {locale === "zh"
                ? "\u8be5\u5206\u7c7b\u8bfe\u7a0b\u9700\u8981\u56e2\u961f\u957f\u6216\u8d85\u7ba1\u4e00\u6b21\u6027\u6388\u6743\u540e\u624d\u80fd\u67e5\u770b\u3002"
                : "This course category requires one bundle approval from your leader or admin."}
            </div>
            <div className="mt-4">
              <a
                className="inline-flex px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
                href={`/${locale}/system/courses`}
              >
                {locale === "zh" ? "\u8fd4\u56de\u8bfe\u7a0b\u5217\u8868" : "Back to courses"}
              </a>
            </div>
          </div>
        </div>
      );
    }
    return (
      <CourseAccessGateClient
        locale={locale}
        courseId={courseId}
        courseTitleZh={(course as any)?.title_zh || null}
        courseTitleEn={(course as any)?.title_en || null}
        status={status}
        rejectionReason={(access as any)?.rejection_reason || null}
        blocked={Boolean(blockState.code)}
        blockedReason={getCourseRequestBlockMessage(blockState.code, locale)}
      />
    );
  }

  const publishedRaw = (course as any)?.published;
  const deletedAt = (course as any)?.deleted_at;
  const publishedValue =
    typeof publishedRaw === "boolean"
      ? publishedRaw
      : typeof publishedRaw === "number"
        ? publishedRaw !== 0
        : typeof publishedRaw === "string"
          ? !["0", "false", "f", "no", "n"].includes(publishedRaw.toLowerCase())
          : false;
  const isPublished = !deletedAt && publishedValue;

  const bucket = (course as any)?.content_bucket;
  const path = (course as any)?.content_path;
  const mime = String((course as any)?.content_mime_type || "");
  const fileName = (course as any)?.content_file_name || null;
  const ext = String(fileName || path || "")
    .toLowerCase()
    .split(".")
    .pop();
  const isVideo = mime.startsWith("video/") || ext === "mp4";
  const isOfficeDoc =
    [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ].includes(mime) || ["doc", "docx", "xls", "xlsx"].includes(ext || "");
  const isDoc = mime === "application/pdf" || mime.startsWith("image/") || mime.startsWith("text/") || ext === "pdf" || isOfficeDoc;
  const variantsRaw = (course as any)?.video_variants;
  let variants: any[] = [];
  if (Array.isArray(variantsRaw)) {
    variants = variantsRaw;
  } else if (typeof variantsRaw === "string" && variantsRaw.trim()) {
    try {
      const parsed = JSON.parse(variantsRaw);
      if (Array.isArray(parsed)) variants = parsed;
    } catch {
      // ignore
    }
  }

  let signedUrl: string | null = null;
  if (bucket && path) {
    signedUrl = await createSignedDownloadUrl(storageAdmin, bucket, path, 3600);
  }

  const courseForClient: any = { ...course };
  if (signedUrl) {
    if (isVideo) {
      courseForClient.video_url = signedUrl;
    } else if (isDoc) {
      courseForClient.doc_url = isOfficeDoc
        ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`
        : signedUrl;
      courseForClient.content_url = `/api/system/courses/${courseId}/download`;
      courseForClient.content_file_name = fileName;
      courseForClient.content_mime_type = mime || null;
    } else {
      courseForClient.content_url = `/api/system/courses/${courseId}/download`;
      courseForClient.content_file_name = fileName;
      courseForClient.content_mime_type = mime || null;
    }
  }

  if (isVideo && variants.length) {
    const signedVariants = [];
    for (const variant of variants) {
      const label = String(variant?.label || variant?.quality || "").trim();
      const variantPath = String(variant?.path || "").trim();
      const bucketName = String(variant?.bucket || bucket || "").trim();
      if (!label || !variantPath || !bucketName) continue;
      const signed = await createSignedDownloadUrl(storageAdmin, bucketName, variantPath, 3600);
      if (!signed) continue;
      signedVariants.push({
        label,
        url: signed,
        mime_type: variant?.mime_type || null
      });
    }
    if (signedVariants.length) {
      courseForClient.video_variants = signedVariants;
    }
  }

  const hasContent = Boolean(
    courseForClient.video_url ||
      courseForClient.doc_url ||
      courseForClient.content_url ||
      (courseForClient.video_variants && courseForClient.video_variants.length)
  );
  const isReleased = isPublished || canView;
  if (!isReleased || !hasContent) {
    return (
      <div className="space-y-6 max-w-[900px]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="text-white/90 font-semibold text-xl">{displayTitle}</div>
          <div className="mt-1 text-xs text-white/45">{displayCode}</div>
          <div className="mt-3 text-white/60 text-sm leading-6">
            {locale === "zh" ? "\u8bfe\u7a0b\u5185\u5bb9\u5c1a\u672a\u53d1\u5e03\u3002" : "Course content is not published yet."}
          </div>
          <div className="mt-4">
            <a
              className="inline-flex px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
              href={`/${locale}/system/courses`}
            >
              {locale === "zh" ? "\u8fd4\u56de\u8bfe\u7a0b\u5217\u8868" : "Back to courses"}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CoursePlayerClient
      locale={locale}
      course={courseForClient}
      access={
        (access as any) || {
          id: `group-${courseId}`,
          course_id: courseId,
          status: "approved",
          progress: 0,
          last_video_sec: 0
        }
      }
      courseList={(courseList || []) as any[]}
      initialSummary={
        note
          ? {
              content_md: (note as any).content_md || "",
              content_html: summaryHtml || null,
              submitted_at: (note as any).submitted_at || null,
              reviewed_at: (note as any).reviewed_at || null,
              review_note: (note as any).review_note || null
            }
          : null
      }
    />
  );
}
