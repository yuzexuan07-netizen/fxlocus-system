import "server-only";

import { dbAll, dbFirst } from "@/lib/d1";
import {
  SYSTEM_ADVANCED_COURSE_FALLBACK_MAX_ID,
  SYSTEM_COGNITIVE_COURSE_FALLBACK_MAX_ID,
  normalizeSystemCourseMaxId
} from "@/lib/system/courseCatalog";
import {
  COURSE_TYPE_ADVANCED,
  COURSE_TYPE_COGNITIVE,
  normalizeCourseType,
  type CourseType
} from "@/lib/system/courseTypes";
import { isMissingSchemaError } from "@/lib/system/schema";

function fallbackMaxIdForCourseType(courseType: CourseType) {
  if (courseType === COURSE_TYPE_COGNITIVE) return SYSTEM_COGNITIVE_COURSE_FALLBACK_MAX_ID;
  if (courseType === COURSE_TYPE_ADVANCED) return SYSTEM_ADVANCED_COURSE_FALLBACK_MAX_ID;
  return 0;
}

export async function getSystemCourseMaxId(courseType: CourseType = COURSE_TYPE_ADVANCED) {
  const normalizedType = normalizeCourseType(courseType);
  try {
    const row = await dbFirst<{ max_id: number | null }>(
      "select max(id) as max_id from courses where coalesce(course_type, 'advanced') = ? and deleted_at is null",
      [normalizedType]
    );
    return normalizeSystemCourseMaxId(row?.max_id, fallbackMaxIdForCourseType(normalizedType));
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }

  const row = await dbFirst<{ max_id: number | null }>("select max(id) as max_id from courses where deleted_at is null");
  return normalizeSystemCourseMaxId(row?.max_id, fallbackMaxIdForCourseType(normalizedType));
}

export async function getSystemCourseIds(courseType: CourseType = COURSE_TYPE_ADVANCED) {
  const normalizedType = normalizeCourseType(courseType);
  try {
    const rows = await dbAll<{ id: number | null }>(
      [
        "select id from courses",
        "where coalesce(course_type, 'advanced') = ? and deleted_at is null",
        "order by coalesce(sort_order, id) asc, id asc"
      ].join(" "),
      [normalizedType]
    );
    return (rows || []).map((row) => Number(row.id || 0)).filter((id) => Number.isInteger(id) && id > 0);
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return [];
  }
}

export async function getSystemCourseCount(courseType: CourseType = COURSE_TYPE_ADVANCED) {
  const normalizedType = normalizeCourseType(courseType);
  try {
    const row = await dbFirst<{ total: number | null }>(
      "select count(1) as total from courses where coalesce(course_type, 'advanced') = ? and deleted_at is null",
      [normalizedType]
    );
    return Math.max(0, Number(row?.total || 0));
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return fallbackMaxIdForCourseType(normalizedType);
  }
}
