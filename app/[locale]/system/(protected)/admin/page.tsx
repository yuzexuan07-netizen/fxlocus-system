import { unstable_noStore } from "next/cache";

import { AdminOverview } from "@/components/system/admin/AdminOverview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminHome({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminOverview locale={locale} />;
}

