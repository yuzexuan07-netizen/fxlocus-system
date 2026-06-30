import { NextResponse } from "next/server";

import { dbAll, dbFirst, sqlPlaceholders, type D1Row } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import {
  COURSE_TYPE_ADVANCED,
  COURSE_TYPE_COGNITIVE,
  normalizeCourseType
} from "@/lib/system/courseTypes";
import { requireSuperAdmin } from "@/lib/system/guard";
import { isMissingSchemaError, toSchemaWarning } from "@/lib/system/schema";
import {
  normalizeStudentStatus,
  STUDENT_STATUS_NORMAL as DEFAULT_STUDENT_STATUS
} from "@/lib/system/studentStatusValues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeaderProfileRow = D1Row & {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  status: string | null;
  created_at: string | null;
  last_login_at: string | null;
};

type TeamMemberRow = D1Row & {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  status: string | null;
  student_status: string | null;
  created_at: string | null;
  last_login_at: string | null;
};

type CourseAccessRow = D1Row & {
  id: string;
  course_id: number;
  status: string | null;
  progress: number | null;
  requested_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
};

type CourseRow = D1Row & {
  id: number;
  course_type?: string | null;
  sort_order?: number | null;
  title_zh?: string | null;
  title_en?: string | null;
};

type CourseGroupAccessRow = D1Row & {
  id: string;
  course_type: string;
  status: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
};

type NormalizedStudent = ReturnType<typeof normalizeStudent>;
type NormalizedLeader = ReturnType<typeof normalizeLeader>;
type LeaderTeam = {
  students: NormalizedStudent[];
  leaders: NormalizedLeader[];
  summary: {
    students: number;
    frozenStudents: number;
    leaders: number;
    frozenLeaders: number;
    byStatus: Record<string, number>;
  };
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function normalizeAccountStatus(input: string | null | undefined): "active" | "frozen" {
  return String(input || "active") === "frozen" ? "frozen" : "active";
}

function emptyTeam(): LeaderTeam {
  return {
    students: [],
    leaders: [],
    summary: {
      students: 0,
      frozenStudents: 0,
      leaders: 0,
      frozenLeaders: 0,
      byStatus: {} as Record<string, number>
    }
  };
}

async function fetchLeaderProfile(leaderId: string) {
  try {
    return await dbFirst<LeaderProfileRow>(
      [
        "select id, full_name, email, phone, role, status, created_at, last_login_at",
        "from profiles",
        "where id = ? and role = 'leader'",
        "limit 1"
      ].join(" "),
      [leaderId]
    );
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return dbFirst<LeaderProfileRow>(
      [
        "select id, full_name, email, phone, role, status,",
        "null as created_at, null as last_login_at",
        "from profiles",
        "where id = ? and role = 'leader'",
        "limit 1"
      ].join(" "),
      [leaderId]
    );
  }
}

async function queryDirectTeamMembers(leaderId: string, roles: string[]) {
  if (!leaderId || !roles.length) return [] as TeamMemberRow[];

  const roleFilter = `role in (${sqlPlaceholders(roles.length)})`;
  const params = [leaderId, ...roles];

  try {
    return await dbAll<TeamMemberRow>(
      [
        "select id, full_name, email, phone, role, status, student_status, created_at, last_login_at",
        "from profiles",
        `where leader_id = ? and ${roleFilter}`,
        "order by created_at desc, id desc"
      ].join(" "),
      params
    );
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return dbAll<TeamMemberRow>(
      [
        "select id, full_name, email, phone, role, status, student_status,",
        "null as created_at, null as last_login_at",
        "from profiles",
        `where leader_id = ? and ${roleFilter}`,
        "order by id desc"
      ].join(" "),
      params
    );
  }
}

function normalizeStudent(row: TeamMemberRow) {
  return {
    id: String(row.id || ""),
    full_name: row.full_name || null,
    email: row.email || null,
    phone: row.phone || null,
    role: row.role || "student",
    status: normalizeAccountStatus(row.status),
    student_status: normalizeStudentStatus(row.student_status),
    created_at: row.created_at || null,
    last_login_at: row.last_login_at || null
  };
}

function normalizeLeader(row: TeamMemberRow) {
  return {
    id: String(row.id || ""),
    full_name: row.full_name || null,
    email: row.email || null,
    phone: row.phone || null,
    role: row.role || "leader",
    status: normalizeAccountStatus(row.status),
    created_at: row.created_at || null,
    last_login_at: row.last_login_at || null
  };
}

async function fetchCourseAccess(leaderId: string) {
  try {
    return await dbAll<CourseAccessRow>(
      [
        "select id, course_id, status, progress, requested_at, reviewed_at, rejection_reason",
        "from course_access",
        "where user_id = ?",
        "order by course_id asc"
      ].join(" "),
      [leaderId]
    );
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return [] as CourseAccessRow[];
  }
}

async function fetchCourses() {
  try {
    return await dbAll<CourseRow>(
      [
        "select id, course_type, sort_order, title_zh, title_en",
        "from courses",
        "where coalesce(course_type, 'advanced') in (?, ?)",
        "and deleted_at is null",
        "order by case coalesce(course_type, 'advanced') when 'cognitive' then 0 when 'advanced' then 1 else 9 end,",
        "coalesce(sort_order, id) asc, id asc"
      ].join(" "),
      [COURSE_TYPE_COGNITIVE, COURSE_TYPE_ADVANCED]
    );
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    try {
      return await dbAll<CourseRow>(
        [
          "select id, course_type, sort_order, title_zh, title_en",
          "from courses",
          "where coalesce(course_type, 'advanced') in (?, ?)",
          "order by case coalesce(course_type, 'advanced') when 'cognitive' then 0 when 'advanced' then 1 else 9 end,",
          "coalesce(sort_order, id) asc, id asc"
        ].join(" "),
        [COURSE_TYPE_COGNITIVE, COURSE_TYPE_ADVANCED]
      );
    } catch (fallbackError) {
      if (!isMissingSchemaError(fallbackError)) throw fallbackError;
      return dbAll<CourseRow>("select id, title_zh, title_en from courses order by id asc");
    }
  }
}

async function fetchCourseGroupAccess(leaderId: string) {
  try {
    return await dbAll<CourseGroupAccessRow>(
      [
        "select id, course_type, status, reviewed_at, reviewed_by, rejection_reason",
        "from course_group_access",
        "where user_id = ?",
        "order by course_type asc"
      ].join(" "),
      [leaderId]
    );
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return [] as CourseGroupAccessRow[];
  }
}

export async function GET(_req: Request, ctx: { params: { leaderId: string } }) {
  try {
    await requireSuperAdmin();

    const leaderId = String(ctx?.params?.leaderId || "").trim();
    if (!leaderId) return json({ ok: false, error: "INVALID_LEADER_ID" }, 400);

    const leader = await fetchLeaderProfile(leaderId);
    if (!leader) return json({ ok: false, error: "NOT_FOUND" }, 404);

    let team = emptyTeam();
    let teamWarning: string | null = null;
    let courseWarning: string | null = null;
    let access: CourseAccessRow[] = [];
    let courses: CourseRow[] = [];
    let groupAccess: CourseGroupAccessRow[] = [];

    try {
      const [studentsRaw, leadersRaw] = await Promise.all([
        queryDirectTeamMembers(leaderId, ["student", "trader", "coach"]),
        queryDirectTeamMembers(leaderId, ["leader"])
      ]);
      const students = studentsRaw.map(normalizeStudent).filter((row) => row.id);
      const leaders = leadersRaw.map(normalizeLeader).filter((row) => row.id);
      const byStatus = students.reduce<Record<string, number>>((acc, row) => {
        const key = row.student_status || DEFAULT_STUDENT_STATUS;
        acc[key] = Number(acc[key] || 0) + 1;
        return acc;
      }, {});

      team = {
        students,
        leaders,
        summary: {
          students: students.length,
          frozenStudents: students.filter((row) => row.status === "frozen").length,
          leaders: leaders.length,
          frozenLeaders: leaders.filter((row) => row.status === "frozen").length,
          byStatus
        }
      };
    } catch (teamError) {
      console.error("[admin/leaders/:id] team load failed", teamError);
      teamWarning = "TEAM_LOAD_FAILED";
    }

    try {
      [access, courses, groupAccess] = await Promise.all([
        fetchCourseAccess(leaderId),
        fetchCourses(),
        fetchCourseGroupAccess(leaderId)
      ]);
    } catch (courseError) {
      console.error("[admin/leaders/:id] course access load failed", courseError);
      courseWarning = "COURSE_LOAD_FAILED";
    }

    const fullCourses = (courses || [])
      .map((course) => ({
        id: Number(course.id || 0),
        course_type: normalizeCourseType(course.course_type),
        sort_order: Number(course.sort_order ?? course.id),
        title_zh: course.title_zh || `第${Number(course.sort_order ?? course.id)}课`,
        title_en: course.title_en || `Lesson ${Number(course.sort_order ?? course.id)}`
      }))
      .filter((course) => course.id > 0);

    return json({
      ok: true,
      leader: {
        id: String(leader.id || leaderId),
        full_name: leader.full_name || null,
        email: leader.email || null,
        phone: leader.phone || null,
        role: leader.role || "leader",
        status: normalizeAccountStatus(leader.status),
        created_at: leader.created_at || null,
        last_login_at: leader.last_login_at || null
      },
      team,
      access: (access || []).map((row) => ({
        id: String(row.id || ""),
        course_id: Number(row.course_id || 0),
        status: String(row.status || ""),
        progress: Number(row.progress || 0),
        requested_at: row.requested_at || null,
        reviewed_at: row.reviewed_at || null,
        rejection_reason: row.rejection_reason || null
      })),
      courses: fullCourses,
      groupAccess: (groupAccess || []).map((row) => ({
        id: String(row.id || ""),
        course_type: normalizeCourseType(row.course_type),
        status: String(row.status || ""),
        reviewed_at: row.reviewed_at || null,
        reviewed_by: row.reviewed_by || null,
        rejection_reason: row.rejection_reason || null
      })),
      teamWarning,
      courseWarning
    });
  } catch (error: any) {
    const mapped = mapSystemApiError(error);
    if (mapped.code === "DB_ERROR" && isMissingSchemaError(error)) {
      return json({ ok: true, leader: null, team: emptyTeam(), schemaWarning: toSchemaWarning(error) });
    }
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
