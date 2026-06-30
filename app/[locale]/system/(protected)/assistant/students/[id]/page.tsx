import { unstable_noStore } from "next/cache";

import { AdminStudentDetailClient } from "@/components/system/admin/AdminStudentDetailClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AssistantStudentDetailPage({
  params
}: {
  params: { locale: "zh" | "en"; id: string };
}) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminStudentDetailClient locale={locale} userId={params.id} />;
}
