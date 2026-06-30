import { NextResponse } from "next/server";

import { dbFirst, dbRun } from "@/lib/d1";
import { getCourseRequestBlockState } from "@/lib/system/courseAccessRules.server";
import { isBundleCourseType, normalizeCourseType } from "@/lib/system/courseTypes";
import { requireLearner } from "@/lib/system/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function isAuthCode(code: string) {
  return code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "FROZEN";
}

function authStatusByCode(code: string) {
  if (code === "FORBIDDEN" || code === "FROZEN") return 403;
  return 401;
}

function isTransientDbError(error: unknown) {
  const message = String((error as any)?.message || "");
  return /database is locked|database is busy|busy/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry(sql: string, params: unknown[], retries = 1) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await dbRun(sql, params);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt >= retries) break;
      await sleep(120 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function POST(req: Request) {
  try {
    const { user } = await requireLearner();
    const body = await req.json().catch(() => null);

    const courseId = Number(body?.courseId);
    if (!Number.isInteger(courseId) || courseId < 1 || courseId > 5000) {
      return json({ ok: false, error: "INVALID_COURSE" }, 400);
    }
    const course = await dbFirst<{ id: number; course_type: string | null }>(
      "select id, course_type from courses where id = ? and deleted_at is null limit 1",
      [courseId]
    );
    if (!course?.id || isBundleCourseType(normalizeCourseType(course.course_type))) {
      return json({ ok: false, error: "INVALID_COURSE" }, 400);
    }

    const now = new Date().toISOString();
    const existing = await dbFirst<{ id: string; status: string | null }>(
      "select id, status from course_access where user_id = ? and course_id = ? limit 1",
      [user.id, courseId]
    );

    if (!existing || existing.status === "rejected") {
      const blockState = await getCourseRequestBlockState(user.id, courseId);
      if (blockState.code) {
        return json({ ok: false, error: blockState.code }, 400);
      }
    }

    if (!existing) {
      await runWithRetry(
        "insert into course_access (user_id, course_id, status, requested_at, updated_at) values (?, ?, ?, ?, ?)",
        [user.id, courseId, "requested", now, now],
        2
      );
      return json({ ok: true });
    }

    if (existing.status === "rejected") {
      await runWithRetry(
        [
          "update course_access set status = ?, requested_at = ?, reviewed_at = null, reviewed_by = null,",
          "rejection_reason = null, updated_at = ? where id = ?"
        ].join(" "),
        ["requested", now, now, existing.id],
        2
      );
    }

    return json({ ok: true });
  } catch (error: any) {
    const code = String(error?.code || "");
    if (isAuthCode(code)) {
      return json({ ok: false, error: code }, authStatusByCode(code));
    }
    if (isTransientDbError(error)) {
      console.warn("[courses/request] transient db error", error);
      return json({ ok: false, error: "DB_BUSY" }, 503);
    }
    console.error("[courses/request] request failed", error);
    return json({ ok: false, error: "REQUEST_FAILED" }, 500);
  }
}
