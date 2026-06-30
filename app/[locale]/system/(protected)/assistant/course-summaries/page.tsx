import { unstable_noStore } from "next/cache";

import { AdminCourseSummariesClient } from "@/components/system/admin/AdminCourseSummariesClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AssistantCourseSummariesPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminCourseSummariesClient locale={locale} />;
}
