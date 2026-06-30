import { unstable_noStore } from "next/cache";

import { AdminReportsClient } from "@/components/system/admin/AdminReportsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function CoachReportsPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminReportsClient locale={locale} meRole="coach" />;
}
