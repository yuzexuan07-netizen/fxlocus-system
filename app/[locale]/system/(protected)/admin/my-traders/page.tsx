import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";

import { requireSystemUser } from "@/lib/system/auth";
import { AdminMyTradersClient } from "@/components/system/admin/AdminMyTradersClient";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  if (user.role !== "leader") redirect(`/${locale}/system/403`);
  return <AdminMyTradersClient locale={locale} />;
}
