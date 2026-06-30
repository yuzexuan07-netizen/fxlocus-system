import { unstable_noStore } from "next/cache";

import { AdminStudentsClient } from "@/components/system/admin/AdminStudentsClient";
import { getSystemCourseCount } from "@/lib/system/courseCatalog.server";
import { COURSE_TYPE_ADVANCED } from "@/lib/system/courseTypes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AssistantStudentsPage({
  params
}: {
  params: { locale: "zh" | "en" };
}) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const maxOpenCourses = await getSystemCourseCount(COURSE_TYPE_ADVANCED);
  return <AdminStudentsClient locale={locale} maxOpenCourses={maxOpenCourses} />;
}
