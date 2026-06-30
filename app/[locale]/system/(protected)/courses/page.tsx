import { unstable_noStore } from "next/cache";

import { CoursesClient } from "@/components/system/CoursesClient";
import { AdminCourseAccessClient } from "@/components/system/admin/AdminCourseAccessClient";
import { dbAll } from "@/lib/d1";
import { getSystemAuth } from "@/lib/system/auth";
import { hasSubmittedRequiredStudentDocuments } from "@/lib/system/courseAccessRules.server";
import { isSuperAdmin } from "@/lib/system/roles";
import { isMissingSchemaError } from "@/lib/system/schema";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CoursesPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const auth = await getSystemAuth();
  if (!auth.ok) return null;

  if (isSuperAdmin(auth.user.role)) {
    return <AdminCourseAccessClient locale={locale} />;
  }

  const [coursesRaw, access, notes, profileSubmitted, groupAccess] = await Promise.all([
    dbAll(
      [
        "select * from courses",
        "where deleted_at is null",
        "order by case coalesce(course_type, 'advanced')",
        "when 'cognitive' then 1 when 'advanced' then 2 when 'model' then 3 when 'mojing' then 4 else 9 end,",
        "coalesce(sort_order, id) asc, id asc"
      ].join(" ")
    ).catch((error) => {
      if (!isMissingSchemaError(error)) throw error;
      return dbAll("select * from courses order by id asc");
    }),
    dbAll("select * from course_access where user_id = ?", [auth.user.id]),
    dbAll("select course_id, submitted_at from course_notes where user_id = ?", [auth.user.id]),
    hasSubmittedRequiredStudentDocuments(auth.user.id),
    dbAll("select * from course_group_access where user_id = ?", [auth.user.id]).catch((error) => {
      if (!isMissingSchemaError(error)) throw error;
      return [];
    })
  ]);

  const fullCourses = ((coursesRaw || []) as any[]).map((course) => ({
    ...course,
    course_type: course.course_type || "advanced",
    sort_order: course.sort_order ?? course.id
  }));

  return (
    <CoursesClient
      locale={locale}
      courses={fullCourses as any[]}
      access={(access || []) as any[]}
      notes={(notes || []) as any[]}
      groupAccess={(groupAccess || []) as any[]}
      profileSubmitted={profileSubmitted}
    />
  );
}
