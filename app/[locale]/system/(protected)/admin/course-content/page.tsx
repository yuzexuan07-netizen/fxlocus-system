import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";

import { AdminCourseContentClient } from "@/components/system/admin/AdminCourseContentClient";
import { requireSystemUser } from "@/lib/system/auth";
import { isSuperAdmin } from "@/lib/system/roles";
import { dbAdmin } from "@/lib/system/dbAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminCourseContentPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  if (!isSuperAdmin(user.role)) redirect(`/${locale}/system/403`);

  const admin = dbAdmin();
  const { data: coursesRaw } = await admin
    .from("courses")
    .select("*")
    .order("id", { ascending: true })
    .limit(500);

  return <AdminCourseContentClient locale={locale} initialCourses={(coursesRaw || []) as any[]} />;
}
