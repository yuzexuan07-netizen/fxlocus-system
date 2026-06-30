import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireLearner } from "@/lib/system/guard";
import { buildStudentSubmitContent, notifyLeadersAndAdmins } from "@/lib/system/notify";
import { ensureCourseProgressAccess } from "@/lib/system/courseAuthorization.server";
import { dbFirst, dbRun } from "@/lib/d1";
import { rewriteHtmlStorageUrlsToProxy } from "@/lib/storage/objectUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  contentHtml: z.string().max(200_000).optional(),
  contentText: z.string().max(200_000).optional(),
  submit: z.boolean().optional()
});

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest, ctx: { params: { courseId: string } }) {
  let userId = "";
  let actor: Awaited<ReturnType<typeof requireLearner>>["user"] | null = null;
  try {
    const res = await requireLearner();
    userId = res.user.id;
    actor = res.user;
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return noStoreJson({ ok: false, error: code }, status);
  }

  const courseId = Number(ctx.params.courseId);
  if (!Number.isInteger(courseId) || courseId < 1 || courseId > 5000) {
    return noStoreJson({ ok: false, error: "INVALID_COURSE" }, 400);
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ ok: false, error: "INVALID_BODY" }, 400);

  const now = new Date().toISOString();

  const { state, access } = await ensureCourseProgressAccess(userId, courseId);
  if (!state.course) return noStoreJson({ ok: false, error: "INVALID_COURSE" }, 400);
  if (!access) return noStoreJson({ ok: false, error: "NO_ACCESS" }, 403);
  if (access.status !== "approved" && access.status !== "completed") {
    return noStoreJson({ ok: false, error: "NOT_APPROVED" }, 403);
  }

  const contentHtml = rewriteHtmlStorageUrlsToProxy(String(parsed.data.contentHtml || ""));
  const contentText = String(parsed.data.contentText || "");
  const isSubmit = Boolean(parsed.data.submit);
  const hasContent = contentText.trim().length > 0 || contentHtml.trim().length > 0;
  if (isSubmit && !hasContent) return noStoreJson({ ok: false, error: "MISSING_CONTENT" }, 400);

  const existing = await dbFirst<{ id: string }>(
    "select id from course_notes where user_id = ? and course_id = ? limit 1",
    [userId, courseId]
  );

  if (existing?.id) {
    const setParts = [
      "content_md = ?",
      "content_html = ?",
      "updated_at = ?",
      isSubmit ? "submitted_at = ?" : null,
      isSubmit ? "reviewed_at = null" : null,
      isSubmit ? "reviewed_by = null" : null,
      isSubmit ? "review_note = null" : null
    ].filter(Boolean) as string[];
    const params: unknown[] = [contentText, contentHtml, now];
    if (isSubmit) params.push(now);
    params.push(existing.id);
    await dbRun(`update course_notes set ${setParts.join(", ")} where id = ?`, params);
  } else {
    await dbRun(
      [
        "insert into course_notes (user_id, course_id, content_md, content_html, submitted_at, reviewed_at, reviewed_by, review_note, updated_at)",
        "values (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ].join(" "),
      [
        userId,
        courseId,
        contentText,
        contentHtml,
        isSubmit ? now : null,
        isSubmit ? null : null,
        isSubmit ? null : null,
        isSubmit ? null : null,
        now
      ]
    );
  }
  if (isSubmit && actor) {
    await notifyLeadersAndAdmins(actor, {
      title: "课程总结提交 / Course summary submitted",
      content: buildStudentSubmitContent(
        actor,
        `提交了第 ${courseId} 课总结。`,
        `submitted course #${courseId} summary.`
      )
    });
  }
  return noStoreJson({ ok: true, submitted: isSubmit });
}
