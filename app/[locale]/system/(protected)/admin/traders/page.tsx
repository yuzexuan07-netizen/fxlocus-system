import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";

import { requireSystemUser } from "@/lib/system/auth";
import { isSuperAdmin } from "@/lib/system/roles";
import { AdminTradersClient } from "@/components/system/admin/AdminTradersClient";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  if (!isSuperAdmin(user.role)) redirect(`/${locale}/system/403`);

  return <AdminTradersClient locale={locale} />;
}
