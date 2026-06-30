import { unstable_noStore } from "next/cache";

import { LadderViewer } from "@/components/system/LadderViewer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function LadderPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <LadderViewer locale={locale} />;
}

