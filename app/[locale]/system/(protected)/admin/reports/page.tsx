import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";

import { AdminReportsClient } from "@/components/system/admin/AdminReportsClient";
import { requireSystemUser } from "@/lib/system/auth";
import { isSuperAdmin } from "@/lib/system/roles";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminReportsPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  if (!isSuperAdmin(user.role)) redirect(`/${locale}/system/403`);

  return <AdminReportsClient locale={locale} meRole="super_admin" />;
}

