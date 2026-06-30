import { unstable_noStore } from "next/cache";

import { ClassicTradesClient } from "@/components/system/ClassicTradesClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ClassicTradesPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <ClassicTradesClient locale={locale} />;
}
