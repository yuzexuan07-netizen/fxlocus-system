import { unstable_noStore } from "next/cache";

import { AdminWeeklySummariesClient } from "@/components/system/admin/AdminWeeklySummariesClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminLeaderWeeklySummariesPage({
  params
}: {
  params: { locale: "zh" | "en" };
}) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminWeeklySummariesClient locale={locale} roleFilter="leader" />;
}
