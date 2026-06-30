import { unstable_noStore } from "next/cache";

import { TrialAccessClient } from "@/components/system/TrialAccessClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function TrialAccessPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <TrialAccessClient locale={locale} mode="main" />;
}
