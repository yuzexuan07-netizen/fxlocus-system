import { unstable_noStore } from "next/cache";

import { AdminTradeSubmissionsClient } from "@/components/system/admin/AdminTradeSubmissionsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function CoachTradeLogsPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminTradeSubmissionsClient locale={locale} type="trade_log" />;
}
