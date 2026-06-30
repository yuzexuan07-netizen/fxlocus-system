import { unstable_noStore } from "next/cache";

import { AdminCourseAccessClient } from "@/components/system/admin/AdminCourseAccessClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminCoursesPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <AdminCourseAccessClient locale={locale} />;
}

