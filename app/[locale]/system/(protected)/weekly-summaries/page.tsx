import { unstable_noStore } from "next/cache";

import { WeeklySummariesClient } from "@/components/system/WeeklySummariesClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function WeeklySummariesPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <WeeklySummariesClient locale={locale} />;
}
