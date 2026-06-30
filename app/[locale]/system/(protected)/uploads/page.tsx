import { unstable_noStore } from "next/cache";
import { redirect } from "next/navigation";

import { StudentDocumentsUploadClient } from "@/components/system/StudentDocumentsUploadClient";
import { requireSystemUser } from "@/lib/system/auth";
import { STUDENT_STATUS_NORMAL } from "@/lib/system/studentStatusValues";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StudentUploadsPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  if (user.student_status !== STUDENT_STATUS_NORMAL) {
    redirect(`/${locale}/system/dashboard`);
  }
  return <StudentDocumentsUploadClient locale={locale} />;
}
