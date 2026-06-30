import { unstable_noStore } from "next/cache";

import { ProfileClient } from "@/components/system/ProfileClient";
import { requireSystemUser } from "@/lib/system/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProfilePage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  return <ProfileClient locale={locale} initialMe={{ ok: true, user: { ...user, status: user.status === "frozen" ? "frozen" : "active" } }} />;
}

