import { dbFirst, dbRun } from "@/lib/d1";
import { COURSE_TYPE_COGNITIVE } from "@/lib/system/courseTypes";
import {
  normalizeStudentStatus,
  STUDENT_STATUS_LEARNING,
  STUDENT_STATUS_NORMAL,
  STUDENT_STATUS_PASSED
} from "@/lib/system/studentStatusValues";

const OPEN_STATUSES = ["approved", "completed"] as const;
const LEARNING_ENTRY_COURSE_ID = 1;

export async function hasUnlockedLearningEntryCourse(userId: string): Promise<boolean> {
  if (!userId) return false;
  let row: { unlocked: number } | null;
  try {
    row = await dbFirst<{ unlocked: number }>(
      [
        "select 1 as unlocked from course_access a",
        "join courses c on c.id = a.course_id",
        "where a.user_id = ? and a.course_id = ?",
        "and coalesce(c.course_type, 'advanced') = ?",
        "and a.status in (?, ?)",
        "and c.deleted_at is null",
        "limit 1"
      ].join(" "),
      [userId, LEARNING_ENTRY_COURSE_ID, COURSE_TYPE_COGNITIVE, ...OPEN_STATUSES]
    );
  } catch (error: any) {
    const message = String(error?.message || "");
    if (!/no such column:\s*c\.course_type/i.test(message)) throw error;
    row = await dbFirst<{ unlocked: number }>(
      [
        "select 1 as unlocked from course_access a",
        "join courses c on c.id = a.course_id",
        "where a.user_id = ? and a.course_id = ?",
        "and a.status in (?, ?)",
        "and c.deleted_at is null",
        "limit 1"
      ].join(" "),
      [userId, LEARNING_ENTRY_COURSE_ID, ...OPEN_STATUSES]
    );
  }
  return Number(row?.unlocked || 0) > 0;
}

export async function ensureLearningStatus(userId: string): Promise<boolean> {
  if (!userId) return false;
  const unlocked = await hasUnlockedLearningEntryCourse(userId);
  if (!unlocked) return false;

  const profile = await dbFirst<{ student_status: string | null }>(
    "select student_status from profiles where id = ? limit 1",
    [userId]
  );
  const currentStatus = normalizeStudentStatus(profile?.student_status, STUDENT_STATUS_NORMAL);
  if (currentStatus === STUDENT_STATUS_LEARNING) return false;
  if (currentStatus !== STUDENT_STATUS_NORMAL && currentStatus !== STUDENT_STATUS_PASSED) return false;

  const now = new Date().toISOString();
  const res = await dbRun(
    "update profiles set student_status = ?, updated_at = ? where id = ?",
    [STUDENT_STATUS_LEARNING, now, userId]
  );
  const changes = (res as any)?.meta?.changes ?? 0;
  return changes > 0;
}
