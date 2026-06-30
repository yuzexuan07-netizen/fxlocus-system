import { unstable_noStore } from "next/cache";

import { AdminAssistantsClient } from "@/components/system/admin/AdminAssistantsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminAssistantsPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminAssistantsClient locale={locale} />;
}
