import { NextResponse } from "next/server";

import { buildSqlInFilter, dbAll, dbFirst, sqlPlaceholders } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { hasSubmittedRequiredStudentDocuments } from "@/lib/system/courseAccessRules.server";
import { COURSE_TYPE_COGNITIVE } from "@/lib/system/courseTypes";
import { requireSystemUser } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { isLearnerRole } from "@/lib/system/roles";
import {
  STUDENT_STATUS_DONATION,
  STUDENT_STATUS_LEARNING,
  STUDENT_STATUS_NORMAL,
  STUDENT_STATUS_PASSED
} from "@/lib/system/studentStatusValues";
import { getTrialAccessEligibility } from "@/lib/system/trialAccessEligibility.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CourseSummaryRow = {
  id: number | null;
  course_type: string | null;
  sort_order: number | null;
  title_zh: string | null;
  title_en: string | null;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" }
  });
}

const STUDENT_STATUSES = [
  STUDENT_STATUS_NORMAL,
  STUDENT_STATUS_PASSED,
  STUDENT_STATUS_LEARNING,
  STUDENT_STATUS_DONATION
] as const;
const COURSE_STATUSES = ["requested", "approved", "rejected", "completed"] as const;
const LEARNER_ROLES = ["student", "trader", "coach"] as const;

function buildInClause(field: string, ids: string[] | null) {
  const filter = buildSqlInFilter(field, ids);
  if (!filter.sql) return { sql: "", params: [] as unknown[] };
  return {
    sql: ` and ${filter.sql}`,
    params: filter.params
  };
}

async function listCoursesForDashboard() {
  try {
    return await dbAll<CourseSummaryRow>(
      [
        "select id, course_type, sort_order, title_zh, title_en from courses",
        "where deleted_at is null",
        "order by case coalesce(course_type, 'advanced')",
        "when 'cognitive' then 0 when 'advanced' then 1 when 'model' then 2 when 'mojing' then 3 else 9 end,",
        "coalesce(sort_order, id) asc, id asc"
      ].join(" ")
    );
  } catch (error: any) {
    const message = String(error?.message || "");
    if (!/no such column:\s*(course_type|sort_order)/i.test(message)) throw error;
    return dbAll<CourseSummaryRow>(
      [
        "select id,",
        "case when id = ? then ? else 'advanced' end as course_type,",
        "id as sort_order, title_zh, title_en from courses",
        "where deleted_at is null",
        "order by id asc"
      ].join(" "),
      [1, COURSE_TYPE_COGNITIVE]
    );
  }
}

export async function GET() {
  try {
    const { user } = await requireSystemUser();

    if (isLearnerRole(user.role)) {
      const [courseRows, rows, documentsSubmitted] = await Promise.all([
        listCoursesForDashboard(),
        dbAll<{
          course_id: number | null;
          status: string | null;
          progress: number | null;
          updated_at: string | null;
        }>("select course_id, status, progress, updated_at from course_access where user_id = ?", [user.id]),
        hasSubmittedRequiredStudentDocuments(user.id)
      ]);

      const accessByCourseId = new Map(
        (rows || [])
          .map((row) => [Number(row.course_id || 0), row] as const)
          .filter(([courseId]) => courseId > 0)
      );
      const items = (courseRows || [])
        .map((course) => {
          const courseId = Number(course.id || 0);
          const access = accessByCourseId.get(courseId);
          return {
            course_id: courseId,
            course_type: String(course.course_type || "advanced"),
            sort_order: Number(course.sort_order ?? courseId),
            title_zh: course.title_zh || null,
            title_en: course.title_en || null,
            status: String(access?.status || "none"),
            progress: Number(access?.progress || 0),
            updated_at: access?.updated_at ? String(access.updated_at) : null
          };
        })
        .filter((row) => row.course_id > 0);

      const firstCognitive = items.find((item) => item.course_type === COURSE_TYPE_COGNITIVE);
      const hasCourseChart = Boolean(firstCognitive && ["approved", "completed"].includes(firstCognitive.status));
      const activeItems = items.filter((row) => row.status !== "none");
      const completed = activeItems.filter((row) => row.status === "completed").length;
      const approved = activeItems.filter((row) => row.status === "approved").length;
      const requested = activeItems.filter((row) => row.status === "requested").length;
      const latest = activeItems
        .slice()
        .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
        .slice(0, 3);

      const trialAccess = await getTrialAccessEligibility(user, { documentsSubmitted });

      return json({
        ok: true,
        kind: "student",
        role: user.role,
        totalCourses: items.length,
        hasCourseChart,
        documentsSubmitted,
        showOnboardingGuide: trialAccess.eligible,
        counts: { completed, approved, requested },
        items,
        latest
      });
    }

    let leaderTree: string[] | null = null;
    if (user.role === "leader") {
      leaderTree = await fetchLeaderTreeIds(user.id);
      if (!leaderTree.length) {
        return json({
          ok: true,
          kind: "admin",
          role: user.role,
          students: { total: 0, frozen: 0, byStatus: Object.fromEntries(STUDENT_STATUSES.map((status) => [status, 0])) },
          courses: Object.fromEntries(COURSE_STATUSES.map((status) => [status, 0])),
          pending: { fileAccessRequests: 0 }
        });
      }
    }

    const rolePlaceholders = sqlPlaceholders(LEARNER_ROLES.length);
    const profileScope = buildInClause("id", leaderTree);
    const profiles = await dbAll<{ id: string; student_status: string | null; status: string | null }>(
      `select id, student_status, status from profiles
       where role in (${rolePlaceholders})${profileScope.sql}
       order by created_at desc
       limit 5000`,
      [...LEARNER_ROLES, ...profileScope.params]
    );

    const students = profiles || [];
    const totalStudents = students.length;
    const frozenStudents = students.filter((student) => String(student.status || "active") === "frozen").length;

    const byStudentStatus: Record<string, number> = {};
    for (const status of STUDENT_STATUSES) byStudentStatus[status] = 0;
    for (const row of students) {
      const key = String(row.student_status || STUDENT_STATUS_NORMAL);
      byStudentStatus[key] = (byStudentStatus[key] || 0) + 1;
    }

    const courseCounts: Record<string, number> = {};
    for (const status of COURSE_STATUSES) courseCounts[status] = 0;

    const scopedUserIds = user.role === "leader" ? students.map((student) => String(student.id)).filter(Boolean) : null;
    const courseScope = buildInClause("user_id", scopedUserIds);
    if (scopedUserIds && scopedUserIds.length === 0) {
      return json({
        ok: true,
        kind: "admin",
        role: user.role,
        students: { total: totalStudents, frozen: frozenStudents, byStatus: byStudentStatus },
        courses: courseCounts,
        pending: { fileAccessRequests: 0 }
      });
    }

    const statusPlaceholders = sqlPlaceholders(COURSE_STATUSES.length);
    const courseRows = await dbAll<{ status: string | null; total: number }>(
      `select status, count(1) as total from course_access
       where status in (${statusPlaceholders})${courseScope.sql}
       group by status`,
      [...COURSE_STATUSES, ...courseScope.params]
    );

    courseRows.forEach((row) => {
      const key = String(row.status || "");
      if (key && key in courseCounts) {
        courseCounts[key] = Number(row.total || 0);
      }
    });

    const fileScope = buildInClause("user_id", scopedUserIds);
    const fileReq = await dbFirst<{ total: number }>(
      `select count(1) as total from file_access_requests where status = 'requested'${fileScope.sql}`,
      fileScope.params
    );

    return json({
      ok: true,
      kind: "admin",
      role: user.role,
      students: { total: totalStudents, frozen: frozenStudents, byStatus: byStudentStatus },
      courses: courseCounts,
      pending: { fileAccessRequests: Number(fileReq?.total || 0) }
    });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
