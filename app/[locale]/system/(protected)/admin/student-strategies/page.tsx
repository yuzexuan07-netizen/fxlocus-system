import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";

import { AdminTradeArchiveClient } from "@/components/system/admin/AdminTradeArchiveClient";
import { requireSystemUser } from "@/lib/system/auth";
import { isAdminRole } from "@/lib/system/roles";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StudentStrategiesPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  if (!isAdminRole(user.role)) redirect(`/${locale}/system/403`);

  return <AdminTradeArchiveClient locale={locale} />;
}
