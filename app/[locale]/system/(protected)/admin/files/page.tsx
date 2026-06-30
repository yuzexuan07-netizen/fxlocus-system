import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";

import { AdminFilesClient } from "@/components/system/admin/AdminFilesClient";
import { requireSystemUser } from "@/lib/system/auth";
import { isSuperAdmin } from "@/lib/system/roles";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminFilesPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  if (!isSuperAdmin(user.role)) redirect(`/${locale}/system/403`);
  return <AdminFilesClient locale={locale} />;
}

