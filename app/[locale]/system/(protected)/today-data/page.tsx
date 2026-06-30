import { unstable_noStore } from "next/cache";

import { TodayDataClient } from "@/components/system/TodayDataClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function TodayDataPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <TodayDataClient locale={locale} />;
}
