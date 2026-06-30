import { unstable_noStore } from "next/cache";
import { redirect } from "next/navigation";

import { getSystemAuth } from "@/lib/system/auth";
import { isMobileAppRequest } from "@/lib/system/mobileApp";
import { isAdminRole } from "@/lib/system/roles";

export const dynamic = "force-dynamic";

export default async function SystemEntry({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const isMobileApp = isMobileAppRequest();

  const auth = await getSystemAuth();
  if (auth.ok) {
    if (isMobileApp) redirect(`/${locale}/system/notifications`);
    if (auth.user.role === "coach") redirect(`/${locale}/system/coach/trade-logs`);
    if (auth.user.role === "assistant") redirect(`/${locale}/system/assistant`);
    if (isAdminRole(auth.user.role)) redirect(`/${locale}/system/admin`);
    redirect(`/${locale}/system/dashboard`);
  }

  redirect(`/${locale}/system/login`);
}
