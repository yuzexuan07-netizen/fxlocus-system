import { unstable_noStore } from "next/cache";

import { AdminLadderClient } from "@/components/system/admin/AdminLadderClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminLadderPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminLadderClient locale={locale} />;
}

