import { NextRequest, NextResponse } from "next/server";

import { dbFirst, dbRun } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { getCourseRequestBlockState } from "@/lib/system/courseAccessRules.server";
import { isBundleCourseType, normalizeCourseType } from "@/lib/system/courseTypes";
import { requireLearner } from "@/lib/system/guard";
import { buildStudentSubmitContent, notifyLeadersAndAdmins } from "@/lib/system/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function isUniqueConstraintError(error: unknown) {
  const text = `${String((error as any)?.code || "")} ${String((error as any)?.message || "")}`.toLowerCase();
  return text.includes("constraint failed") || text.includes("unique constraint");
}

export async function POST(_req: NextRequest, ctx: { params: { courseId: string } }) {
  let userId = "";
  let actor: Awaited<ReturnType<typeof requireLearner>>["user"] | null = null;
  try {
    const { user } = await requireLearner();
    userId = user.id;
    actor = user;
  } catch (error: any) {
    const mapped = mapSystemApiError(error);
    return noStoreJson({ ok: false, error: mapped.code }, mapped.status);
  }

  const courseId = Number(ctx.params.courseId);
  if (!Number.isInteger(courseId) || courseId < 1 || courseId > 5000) {
    return noStoreJson({ ok: false, error: "INVALID_COURSE" }, 400);
  }
  const course = await dbFirst<{ id: number; course_type: string | null }>(
    "select id, course_type from courses where id = ? and deleted_at is null limit 1",
    [courseId]
  );
  if (!course?.id || isBundleCourseType(normalizeCourseType(course.course_type))) {
    return noStoreJson({ ok: false, error: "INVALID_COURSE" }, 400);
  }

  const now = new Date().toISOString();

  let existing: { id: string; status: string | null } | null = null;
  try {
    existing = await dbFirst<{ id: string; status: string | null }>(
      "select id, status from course_access where user_id = ? and course_id = ? limit 1",
      [userId, courseId]
    );
  } catch (error: any) {
    const mapped = mapSystemApiError(error, "DB_ERROR");
    return noStoreJson({ ok: false, error: mapped.code }, mapped.status);
  }

  if (!existing || existing.status === "rejected") {
    const blockState = await getCourseRequestBlockState(userId, courseId);
    if (blockState.code) {
      return noStoreJson({ ok: false, error: blockState.code }, 400);
    }
  }

  if (!existing) {
    try {
      await dbRun(
        "insert into course_access (user_id, course_id, status, requested_at, updated_at) values (?, ?, ?, ?, ?)",
        [userId, courseId, "requested", now, now]
      );
    } catch (error: any) {
      if (!isUniqueConstraintError(error)) {
        const mapped = mapSystemApiError(error, "DB_ERROR");
        return noStoreJson({ ok: false, error: mapped.code }, mapped.status);
      }
    }

    if (actor) {
      await notifyLeadersAndAdmins(actor, {
        title: "\u8bfe\u7a0b\u7533\u8bf7 / Course request",
        content: buildStudentSubmitContent(actor, `\u7533\u8bf7\u4e86\u7b2c ${courseId} \u8bfe\u3002`, `requested course #${courseId}.`)
      });
    }
    return noStoreJson({ ok: true });
  }

  if (existing.status === "rejected") {
    try {
      await dbRun(
        [
          "update course_access set status = ?, requested_at = ?, reviewed_at = null, reviewed_by = null,",
          "rejection_reason = null, updated_at = ? where id = ?"
        ].join(" "),
        ["requested", now, now, existing.id]
      );
    } catch (error: any) {
      const mapped = mapSystemApiError(error, "DB_ERROR");
      return noStoreJson({ ok: false, error: mapped.code }, mapped.status);
    }

    if (actor) {
      await notifyLeadersAndAdmins(actor, {
        title: "\u8bfe\u7a0b\u7533\u8bf7 / Course request",
        content: buildStudentSubmitContent(actor, `\u7533\u8bf7\u4e86\u7b2c ${courseId} \u8bfe\u3002`, `requested course #${courseId}.`)
      });
    }
  }

  return noStoreJson({ ok: true });
}
