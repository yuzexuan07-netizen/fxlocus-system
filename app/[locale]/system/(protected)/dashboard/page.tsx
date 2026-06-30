import { unstable_noStore } from "next/cache";

import { DashboardClient } from "@/components/system/dashboard/DashboardClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <DashboardClient locale={locale} />;
}
