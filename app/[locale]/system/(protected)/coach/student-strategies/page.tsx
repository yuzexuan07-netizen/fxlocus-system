import { unstable_noStore } from "next/cache";

import { AdminTradeArchiveClient } from "@/components/system/admin/AdminTradeArchiveClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function CoachStudentStrategiesPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return (
    <AdminTradeArchiveClient
      locale={locale}
      lockType="trade_strategy"
      hideTypeFilter
      canDelete={false}
      title={{ zh: "模拟交易策略管理", en: "Simulation Trade Strategy Management" }}
      description={{
        zh: "仅展示你名下学员已存档的模拟交易策略。",
        en: "Only archived simulation trade strategies from students assigned to you."
      }}
    />
  );
}
