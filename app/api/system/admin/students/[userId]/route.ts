import { NextResponse } from "next/server";

import { buildSqlInFilter, dbAll, dbFirst, sqlPlaceholders, type D1Row } from "@/lib/d1";
import { requireManager } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { isMissingSchemaError, toSchemaWarning } from "@/lib/system/schema";
import { mapSystemApiError } from "@/lib/system/apiError";
import { COURSE_TYPE_ADVANCED, COURSE_TYPE_COGNITIVE, normalizeCourseType } from "@/lib/system/courseTypes";
import {
  normalizeStudentStatus,
  STUDENT_STATUS_NORMAL as DEFAULT_STUDENT_STATUS
} from "@/lib/system/studentStatusValues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  status: string | null;
  student_status: string | null;
  leader_id: string | null;
  source: string | null;
  created_at: string | null;
  last_login_at: string | null;
  created_by: string | null;
};

type CourseAccessRow = {
  id: string;
  course_id: number;
  status: string | null;
  progress: number | null;
  requested_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
};

type FilePermissionJoinRow = D1Row & {
  file_id: string;
  created_at: string | null;
  file_name: string | null;
  file_category: string | null;
};

type LadderRow = {
  user_id: string;
  status: string | null;
  enabled: number | null;
  requested_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
};

type CourseRow = {
  id: number;
  course_type?: string | null;
  sort_order?: number | null;
  title_zh?: string | null;
  title_en?: string | null;
};

type CourseGroupAccessRow = {
  id: string;
  course_type: string;
  status: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function isAuthCode(code: string) {
  return code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "FROZEN";
}

function authStatusByCode(code: string) {
  if (code === "FORBIDDEN" || code === "FROZEN") return 403;
  return 401;
}

function normalizeAccountStatus(input: string | null | undefined): "active" | "frozen" {
  return String(input || "active") === "frozen" ? "frozen" : "active";
}

function uniqueList(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function emptyLeaderTeam() {
  return {
    students: [],
    summary: {
      total: 0,
      frozen: 0,
      byStatus: {}
    },
    leaders: [],
    leaderSummary: {
      total: 0,
      active: 0,
      frozen: 0
    }
  };
}

async function queryProfilesByIds(ids: string[], roleFilter?: string[]) {
  const normalizedIds = uniqueList(ids.map((item) => String(item || "").trim()));
  if (!normalizedIds.length) return [] as ProfileRow[];

  const out: ProfileRow[] = [];
  const chunkSize = 300;
  for (let i = 0; i < normalizedIds.length; i += chunkSize) {
    const slice = normalizedIds.slice(i, i + chunkSize);
    const idFilter = buildSqlInFilter("id", slice);
    const whereParts = [idFilter.sql];
    const params: unknown[] = [...idFilter.params];
    if (roleFilter?.length) {
      whereParts.push(`role in (${sqlPlaceholders(roleFilter.length)})`);
      params.push(...roleFilter);
    }
    let rows: ProfileRow[] = [];
    try {
      rows = await dbAll<ProfileRow>(
        [
          "select id, full_name, email, phone, role, status, student_status, leader_id, source,",
          "created_at, last_login_at, null as created_by",
          "from profiles",
          `where ${whereParts.join(" and ")}`
        ].join(" "),
        params
      );
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
      rows = await dbAll<ProfileRow>(
        [
          "select id, full_name, email, phone, role, status, student_status, leader_id,",
          "null as source, null as created_at, null as last_login_at, null as created_by",
          "from profiles",
          `where ${whereParts.join(" and ")}`
        ].join(" "),
        params
      );
    }
    out.push(...rows);
  }
  return out;
}

async function fetchProfileById(userId: string) {
  try {
    return await dbFirst<ProfileRow>(
      [
        "select id, full_name, email, phone, role, status, student_status, leader_id, source,",
        "created_at, last_login_at, created_by",
        "from profiles where id = ? limit 1"
      ].join(" "),
      [userId]
    );
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    try {
      return await dbFirst<ProfileRow>(
        [
          "select id, full_name, email, phone, role, status, student_status, leader_id, source,",
          "created_at, last_login_at, null as created_by",
          "from profiles where id = ? limit 1"
        ].join(" "),
        [userId]
      );
    } catch (fallbackError) {
      if (!isMissingSchemaError(fallbackError)) throw fallbackError;
      return dbFirst<ProfileRow>(
        [
          "select id, full_name, email, phone, role, status, student_status, leader_id,",
          "null as source, null as created_at, null as last_login_at, null as created_by",
          "from profiles where id = ? limit 1"
        ].join(" "),
        [userId]
      );
    }
  }
}

export async function GET(_req: Request, ctx: { params: { userId: string } }) {
  try {
    const { user: actor } = await requireManager();
    if (actor.role === "coach") return json({ ok: false, error: "FORBIDDEN" }, 403);

    const userId = String(ctx?.params?.userId || "").trim();
    if (!userId) return json({ ok: false, error: "INVALID_USER_ID" }, 400);

    const profile = await fetchProfileById(userId);
    if (!profile) return json({ ok: false, error: "NOT_FOUND" }, 404);

    if (actor.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(actor.id);
      if (!treeIds.includes(userId)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    } else if (actor.role === "assistant") {
      const createdBy = String(profile.created_by || "");
      if (profile.id !== actor.id && (!createdBy || createdBy !== actor.id)) {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }
    }

    let access: CourseAccessRow[] = [];
    try {
      access = await dbAll<CourseAccessRow>(
        [
          "select id, course_id, status, progress, requested_at, reviewed_at, rejection_reason",
          "from course_access",
          "where user_id = ?",
          "order by course_id asc"
        ].join(" "),
        [userId]
      );
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
    }

    let courses: CourseRow[] = [];
    try {
      courses = await dbAll<CourseRow>(
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
      courses = await dbAll<CourseRow>("select id, title_zh, title_en from courses order by id asc");
    }

    const fullCourses = (courses || []).map((course) => ({
      id: Number(course.id || 0),
      course_type: normalizeCourseType(course.course_type),
      sort_order: Number(course.sort_order ?? course.id),
      title_zh: course.title_zh || `\u7b2c${Number(course.sort_order ?? course.id)}\u8bfe`,
      title_en: course.title_en || `Lesson ${Number(course.sort_order ?? course.id)}`
    })).filter((course) => course.id > 0);

    let groupAccess: CourseGroupAccessRow[] = [];
    try {
      groupAccess = await dbAll<CourseGroupAccessRow>(
        [
          "select id, course_type, status, reviewed_at, reviewed_by, rejection_reason",
          "from course_group_access",
          "where user_id = ?",
          "order by course_type asc"
        ].join(" "),
        [userId]
      );
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
    }

    let filePermissionRows: FilePermissionJoinRow[] = [];
    try {
      filePermissionRows = await dbAll<FilePermissionJoinRow>(
        [
          "select fp.file_id, fp.created_at, f.name as file_name, f.category as file_category",
          "from file_permissions fp",
          "left join files f on f.id = fp.file_id",
          "where fp.grantee_profile_id = ?",
          "order by fp.created_at desc"
        ].join(" "),
        [userId]
      );
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
    }
    const filePermissions = filePermissionRows.map((row) => ({
      file_id: String(row.file_id || ""),
      created_at: row.created_at || null,
      files: row.file_id
        ? {
            id: String(row.file_id),
            name: row.file_name || null,
            category: row.file_category || null
          }
        : null
    }));

    let ladder: LadderRow | null = null;
    try {
      ladder = await dbFirst<LadderRow>(
        [
          "select user_id, status, enabled, requested_at, reviewed_at, rejection_reason",
          "from ladder_authorizations where user_id = ? limit 1"
        ].join(" "),
        [userId]
      );
    } catch (error) {
      if (!isMissingSchemaError(error)) throw error;
    }

    let team: {
      students: Array<{
        id: string;
        full_name: string | null;
        email: string | null;
        phone: string | null;
        status: "active" | "frozen";
        student_status: string;
        created_at: string | null;
        last_login_at: string | null;
      }>;
      summary: {
        total: number;
        frozen: number;
        byStatus: Record<string, number>;
      };
      leaders: Array<{
        id: string;
        full_name: string | null;
        email: string | null;
        phone: string | null;
        status: "active" | "frozen";
        created_at: string | null;
        last_login_at: string | null;
      }>;
      leaderSummary: {
        total: number;
        active: number;
        frozen: number;
      };
    } | null = null;

    if (String(profile.role || "") === "leader") {
      try {
        const treeIds = await fetchLeaderTreeIds(profile.id);
        const memberIds = uniqueList(treeIds.filter((id) => id && id !== profile.id));
        const teamStudentsRaw = await queryProfilesByIds(memberIds, ["student", "trader", "coach"]);
        const teamLeadersRaw = await queryProfilesByIds(memberIds, ["leader"]);

        const teamStudents = teamStudentsRaw
          .map((row) => ({
            id: String(row.id),
            full_name: row.full_name || null,
            email: row.email || null,
            phone: row.phone || null,
            status: normalizeAccountStatus(row.status),
            student_status: normalizeStudentStatus(row.student_status),
            created_at: row.created_at || null,
            last_login_at: row.last_login_at || null
          }))
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

        const teamLeaders = teamLeadersRaw
          .map((row) => ({
            id: String(row.id),
            full_name: row.full_name || null,
            email: row.email || null,
            phone: row.phone || null,
            status: normalizeAccountStatus(row.status),
            created_at: row.created_at || null,
            last_login_at: row.last_login_at || null
          }))
          .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

        const byStatus = teamStudents.reduce<Record<string, number>>((acc, row) => {
          const key = row.student_status || DEFAULT_STUDENT_STATUS;
          acc[key] = Number(acc[key] || 0) + 1;
          return acc;
        }, {});

        team = {
          students: teamStudents,
          summary: {
            total: teamStudents.length,
            frozen: teamStudents.filter((row) => row.status === "frozen").length,
            byStatus
          },
          leaders: teamLeaders,
          leaderSummary: {
            total: teamLeaders.length,
            active: teamLeaders.filter((row) => row.status === "active").length,
            frozen: teamLeaders.filter((row) => row.status === "frozen").length
          }
        };
      } catch (teamError) {
        console.error("[admin/students/:id] leader team load failed", teamError);
        team = emptyLeaderTeam();
      }
    }

    return json({
      ok: true,
      user: {
        id: String(profile.id),
        full_name: profile.full_name || null,
        email: profile.email || null,
        phone: profile.phone || null,
        role: profile.role || "student",
        status: normalizeAccountStatus(profile.status),
        student_status: normalizeStudentStatus(profile.student_status),
        leader_id: profile.leader_id || null,
        source: profile.source || null,
        created_at: profile.created_at || null,
        last_login_at: profile.last_login_at || null
      },
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
      filePermissions,
      ladder: ladder
        ? {
            user_id: String(ladder.user_id || userId),
            status: String(ladder.status || ""),
            enabled: Boolean(Number(ladder.enabled || 0)),
            requested_at: ladder.requested_at || null,
            reviewed_at: ladder.reviewed_at || null,
            rejection_reason: ladder.rejection_reason || null
          }
        : null,
      team
    });
  } catch (error: any) {
    const mapped = mapSystemApiError(error);
    if (isAuthCode(mapped.code)) {
      return json({ ok: false, error: mapped.code }, authStatusByCode(mapped.code));
    }
    if (mapped.code === "DB_ERROR" && isMissingSchemaError(error)) {
      return json({ ok: true, user: null, access: [], filePermissions: [], ladder: null, team: null, schemaWarning: toSchemaWarning(error) });
    }
    console.error("[admin/students/:id] GET failed", error);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
