import { redirect } from "next/navigation";

import { isAdminRole } from "@/lib/system/roles";
import {
  requireSystemUser as requireSystemUserWithContext,
  type StudentStatus
} from "@/lib/system/guard";

export type Locale = "zh" | "en";

export type SystemUser = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: "student" | "trader" | "coach" | "assistant" | "leader" | "super_admin";
  leader_id: string | null;
  student_status: StudentStatus;
  status: "active" | "frozen" | "deleted";
};

export async function getSystemAuth() {
  try {
    const { user } = await requireSystemUserWithContext();
    return { ok: true as const, user: user as SystemUser };
  } catch (error: any) {
    const code = String(error?.code || "AUTH_FAILED");
    if (code === "FROZEN") return { ok: false as const, reason: "FROZEN" as const };
    return { ok: false as const, reason: "NO_SESSION" as const };
  }
}

export async function requireSystemUser(locale: Locale) {
  const res = await getSystemAuth();
  if (!res.ok) {
    if (res.reason === "FROZEN") redirect(`/${locale}/system/403`);
    redirect(`/${locale}/system/login`);
  }
  return res.user;
}

export async function requireAdmin(locale: Locale) {
  const user = await requireSystemUser(locale);
  if (!isAdminRole(user.role)) redirect(`/${locale}/system/403`);
  return user;
}

export async function requireCoach(locale: Locale) {
  const user = await requireSystemUser(locale);
  if (user.role !== "coach") redirect(`/${locale}/system/403`);
  return user;
}

export async function requireAssistant(locale: Locale) {
  const user = await requireSystemUser(locale);
  if (user.role !== "assistant") redirect(`/${locale}/system/403`);
  return user;
}
