import { unstable_noStore } from "next/cache";

import { AdminStudentDocumentsClient } from "@/components/system/admin/AdminStudentDocumentsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminStudentDocumentsPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminStudentDocumentsClient locale={locale} />;
}
