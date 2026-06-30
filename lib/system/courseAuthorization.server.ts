import "server-only";

import { dbFirst, dbRun } from "@/lib/d1";
import {
  isBundleCourseType,
  normalizeCourseType,
  type CourseType
} from "@/lib/system/courseTypes";
import { isMissingSchemaError } from "@/lib/system/schema";

export type CourseAuthAccessRow = {
  id: string;
  course_id: number;
  status: string | null;
  progress?: number | null;
  last_video_sec?: number | null;
  rejection_reason?: string | null;
};

export type CourseGroupAccessRow = {
  id: string;
  user_id: string;
  course_type: string;
  status: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  rejection_reason?: string | null;
};

export type CourseAuthorizationState = {
  course: Record<string, any> | null;
  courseType: CourseType;
  access: CourseAuthAccessRow | null;
  groupAccess: CourseGroupAccessRow | null;
  status: "none" | "requested" | "approved" | "rejected" | "completed";
  canView: boolean;
  usesGroupAccess: boolean;
};

function isOpenStatus(status: unknown) {
  return status === "approved" || status === "completed";
}

function normalizeStatus(value: unknown): CourseAuthorizationState["status"] {
  const raw = String(value || "").trim();
  if (raw === "requested" || raw === "approved" || raw === "rejected" || raw === "completed") return raw;
  return "none";
}

export async function getCourseRecord(courseId: number) {
  return dbFirst<Record<string, any>>("select * from courses where id = ? limit 1", [courseId]);
}

export async function getCourseGroupAccess(userId: string, courseType: CourseType) {
  try {
    return await dbFirst<CourseGroupAccessRow>(
      "select * from course_group_access where user_id = ? and course_type = ? limit 1",
      [userId, normalizeCourseType(courseType)]
    );
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return null;
  }
}

export async function getCourseAuthorizationState(userId: string, courseId: number): Promise<CourseAuthorizationState> {
  const course = await getCourseRecord(courseId);
  const courseType = normalizeCourseType(course?.course_type);
  const access = await dbFirst<CourseAuthAccessRow>(
    "select id, course_id, status, progress, last_video_sec, rejection_reason from course_access where user_id = ? and course_id = ? limit 1",
    [userId, courseId]
  );

  if (!course?.id) {
    return {
      course: null,
      courseType,
      access,
      groupAccess: null,
      status: normalizeStatus(access?.status),
      canView: false,
      usesGroupAccess: false
    };
  }

  if (!isBundleCourseType(courseType)) {
    const status = normalizeStatus(access?.status);
    return {
      course,
      courseType,
      access,
      groupAccess: null,
      status,
      canView: isOpenStatus(status),
      usesGroupAccess: false
    };
  }

  const groupAccess = await getCourseGroupAccess(userId, courseType);
  const groupStatus = normalizeStatus(groupAccess?.status);
  return {
    course,
    courseType,
    access,
    groupAccess,
    status: groupStatus,
    canView: groupStatus === "approved",
    usesGroupAccess: true
  };
}

export async function ensureCourseProgressAccess(userId: string, courseId: number) {
  const state = await getCourseAuthorizationState(userId, courseId);
  if (!state.canView) return { state, access: null };

  if (state.access && isOpenStatus(state.access.status)) {
    return { state, access: state.access };
  }

  if (!state.usesGroupAccess) {
    return { state, access: null };
  }

  const now = new Date().toISOString();
  await dbRun(
    [
      "insert into course_access",
      "(user_id, course_id, status, requested_at, reviewed_at, reviewed_by, updated_at)",
      "values (?, ?, 'approved', ?, ?, ?, ?)",
      "on conflict(user_id, course_id) do update set",
      "status = case when course_access.status = 'completed' then 'completed' else 'approved' end,",
      "reviewed_at = coalesce(course_access.reviewed_at, excluded.reviewed_at),",
      "reviewed_by = coalesce(course_access.reviewed_by, excluded.reviewed_by),",
      "rejection_reason = null,",
      "updated_at = excluded.updated_at"
    ].join(" "),
    [userId, courseId, now, now, state.groupAccess?.reviewed_by || null, now]
  );

  const access = await dbFirst<CourseAuthAccessRow>(
    "select id, course_id, status, progress, last_video_sec, rejection_reason from course_access where user_id = ? and course_id = ? limit 1",
    [userId, courseId]
  );

  return { state, access };
}
