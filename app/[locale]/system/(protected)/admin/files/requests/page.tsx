import { unstable_noStore } from "next/cache";

import { AdminFileRequestsClient } from "@/components/system/admin/AdminFileRequestsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminFileRequestsPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminFileRequestsClient locale={locale} />;
}

