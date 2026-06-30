import { dbAll, dbFirst } from "@/lib/d1";
import { CourseRequestBlockCode, resolveCourseRequestBlockCode } from "@/lib/system/courseAccessRules";
import {
  COURSE_TYPE_COGNITIVE,
  normalizeCourseType
} from "@/lib/system/courseTypes";
import { ensureLearningStatus, hasUnlockedLearningEntryCourse } from "@/lib/system/studentStatus";
import {
  normalizeStudentStatus,
  STUDENT_STATUS_LEARNING,
  STUDENT_STATUS_NORMAL,
  STUDENT_STATUS_PASSED
} from "@/lib/system/studentStatusValues";

function hasPositiveCount(value: unknown) {
  return Number(value || 0) > 0;
}

export async function hasSubmittedRequiredStudentDocuments(userId: string): Promise<boolean> {
  if (!userId) return false;
  const profile = await dbFirst<{ student_status: string | null }>(
    "select student_status from profiles where id = ? limit 1",
    [userId]
  ).catch(() => null);
  const studentStatus = normalizeStudentStatus(profile?.student_status, STUDENT_STATUS_NORMAL);
  if (studentStatus === STUDENT_STATUS_LEARNING) return true;
  if (studentStatus === STUDENT_STATUS_NORMAL || studentStatus === STUDENT_STATUS_PASSED) {
    const learningUnlocked = await hasUnlockedLearningEntryCourse(userId);
    if (learningUnlocked) {
      await ensureLearningStatus(userId);
      return true;
    }
  }

  const rows = await dbAll<{ doc_type: string | null; total: number | null }>(
    "select doc_type, count(1) as total from student_documents where student_id = ? group by doc_type",
    [userId]
  ).catch((error: any) => {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("no such table") || message.includes("no such column")) return [];
    throw error;
  });

  const counts = new Map<string, number>();
  (rows || []).forEach((row) => {
    const docType = String(row?.doc_type || "").trim();
    if (!docType) return;
    counts.set(docType, Number(row?.total || 0));
  });

  return (
    hasPositiveCount(counts.get("enrollment_form")) &&
    hasPositiveCount(counts.get("trial_screenshot")) &&
    hasPositiveCount(counts.get("verification_image"))
  );
}

export async function getCourseRequestBlockState(userId: string, courseId: number): Promise<{
  profileSubmitted: boolean;
  cognitiveCompleted: boolean;
  previousCourseCompleted: boolean;
  previousSummarySubmitted: boolean;
  code: CourseRequestBlockCode | null;
}> {
  const course = await dbFirst<{ id: number; course_type: string | null; sort_order: number | null }>(
    "select id, course_type, sort_order from courses where id = ? and deleted_at is null limit 1",
    [courseId]
  ).catch(() => null);
  const courseType = normalizeCourseType(course?.course_type);

  const profileSubmittedPromise = hasSubmittedRequiredStudentDocuments(userId);
  const prevCoursePromise = course?.id
    ? dbFirst<{ id: number | null }>(
        [
          "select id from courses",
          "where coalesce(course_type, 'advanced') = ?",
          "and deleted_at is null",
          "and (coalesce(sort_order, id) < coalesce(?, ?) or (coalesce(sort_order, id) = coalesce(?, ?) and id < ?))",
          "order by coalesce(sort_order, id) desc, id desc",
          "limit 1"
        ].join(" "),
        [
          courseType,
          course.sort_order ?? course.id,
          course.id,
          course.sort_order ?? course.id,
          course.id,
          course.id
        ]
      )
    : Promise.resolve(null);
  const cognitiveRowsPromise = dbAll<{ id: number | null }>(
    "select id from courses where coalesce(course_type, 'advanced') = ? and deleted_at is null order by coalesce(sort_order, id) asc, id asc",
    [COURSE_TYPE_COGNITIVE]
  ).catch(() => []);

  const [profileSubmitted, prevCourse, cognitiveRows] = await Promise.all([
    profileSubmittedPromise,
    prevCoursePromise,
    cognitiveRowsPromise
  ]);

  const prevCourseId = Number(prevCourse?.id || 0);
  const prevAccessPromise =
    prevCourseId > 0
      ? dbFirst<{ status: string | null }>(
          "select status from course_access where user_id = ? and course_id = ? limit 1",
          [userId, prevCourseId]
        )
      : Promise.resolve(null);
  const prevNotePromise =
    prevCourseId > 0
      ? dbFirst<{ submitted_at: string | null }>(
          "select submitted_at from course_notes where user_id = ? and course_id = ? limit 1",
          [userId, prevCourseId]
        )
      : Promise.resolve(null);
  const cognitiveIds = (cognitiveRows || [])
    .map((row) => Number(row.id || 0))
    .filter((id) => Number.isInteger(id) && id > 0);
  const cognitiveAccessRows = cognitiveIds.length
    ? await dbAll<{ course_id: number | null; status: string | null }>(
        `select course_id, status from course_access where user_id = ? and course_id in (${cognitiveIds
          .map(() => "?")
          .join(",")})`,
        [userId, ...cognitiveIds]
      ).catch(() => [])
    : [];

  const [prevAccess, prevNote] = await Promise.all([prevAccessPromise, prevNotePromise]);

  const completedCognitiveIds = new Set(
    (cognitiveAccessRows || [])
      .filter((row) => String(row.status || "") === "completed")
      .map((row) => Number(row.course_id || 0))
  );
  const cognitiveCompleted = cognitiveIds.length > 0 && cognitiveIds.every((id) => completedCognitiveIds.has(id));
  const previousCourseCompleted = prevCourseId <= 0 ? true : String(prevAccess?.status || "") === "completed";
  const previousSummarySubmitted = prevCourseId <= 0 ? true : Boolean(prevNote?.submitted_at);

  return {
    profileSubmitted,
    cognitiveCompleted,
    previousCourseCompleted,
    previousSummarySubmitted,
    code: resolveCourseRequestBlockCode({
      courseId,
      courseType,
      profileSubmitted,
      cognitiveCompleted,
      previousCourseCompleted,
      previousSummarySubmitted
    })
  };
}
