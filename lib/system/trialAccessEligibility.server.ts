import "server-only";

import { dbFirst } from "@/lib/d1";
import { hasSubmittedRequiredStudentDocuments } from "@/lib/system/courseAccessRules.server";
import {
  isDonationStudentStatus,
  normalizeStudentStatus,
  STUDENT_STATUS_NORMAL
} from "@/lib/system/studentStatusValues";

type TrialAccessUser = {
  id: string;
  email?: string | null;
  role: string;
  student_status?: string | null;
};

type TrialEligibilityReason =
  | "not_student"
  | "not_normal_student"
  | "donation_status"
  | "donation_record"
  | "course_access"
  | "file_access"
  | "documents_submitted"
  | "eligible";

async function safeFirst<T extends Record<string, unknown>>(sql: string, params: unknown[]) {
  try {
    return await dbFirst<T>(sql, params);
  } catch (error: any) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("no such table") || message.includes("no such column")) return null;
    throw error;
  }
}

async function hasDonationRecord(user: TrialAccessUser) {
  const email = String(user.email || "").trim().toLowerCase();
  if (!email) return false;

  const donationApplication = await safeFirst<{ id: string | null }>(
    "select id from donation_applications where lower(email) = ? limit 1",
    [email]
  );
  if (donationApplication?.id) return true;

  const donationRecord = await safeFirst<{ id: string | null }>(
    "select id from records where type = 'donate' and lower(email) = ? limit 1",
    [email]
  );
  return Boolean(donationRecord?.id);
}

async function hasActiveCourseAccess(userId: string) {
  const row = await safeFirst<{ total: number | null }>(
    "select count(1) as total from course_access where user_id = ? and status in ('requested','approved','completed')",
    [userId]
  );
  return Number(row?.total || 0) > 0;
}

async function hasGrantedFileAccess(userId: string) {
  const row = await safeFirst<{ total: number | null }>(
    "select count(1) as total from file_permissions where grantee_profile_id = ?",
    [userId]
  );
  return Number(row?.total || 0) > 0;
}

export async function getTrialAccessEligibility(
  user: TrialAccessUser,
  options: { documentsSubmitted?: boolean } = {}
): Promise<{ eligible: boolean; reason: TrialEligibilityReason }> {
  if (user.role !== "student") return { eligible: false, reason: "not_student" };

  const studentStatus = normalizeStudentStatus(user.student_status, STUDENT_STATUS_NORMAL);
  if (isDonationStudentStatus(studentStatus)) return { eligible: false, reason: "donation_status" };
  if (studentStatus !== STUDENT_STATUS_NORMAL) return { eligible: false, reason: "not_normal_student" };

  if (await hasDonationRecord(user)) return { eligible: false, reason: "donation_record" };
  if (await hasActiveCourseAccess(user.id)) return { eligible: false, reason: "course_access" };
  if (await hasGrantedFileAccess(user.id)) return { eligible: false, reason: "file_access" };

  const documentsSubmitted =
    typeof options.documentsSubmitted === "boolean"
      ? options.documentsSubmitted
      : await hasSubmittedRequiredStudentDocuments(user.id);
  if (documentsSubmitted) return { eligible: false, reason: "documents_submitted" };

  return { eligible: true, reason: "eligible" };
}
