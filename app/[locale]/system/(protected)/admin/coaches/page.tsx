import { unstable_noStore } from "next/cache";

import { AdminCoachesClient } from "@/components/system/admin/AdminCoachesClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminCoachesPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminCoachesClient locale={locale} />;
}
