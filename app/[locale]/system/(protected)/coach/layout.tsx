import React from "react";
import { unstable_noStore } from "next/cache";

import { requireCoach } from "@/lib/system/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CoachLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { locale: "zh" | "en" };
}) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  await requireCoach(locale);
  return <>{children}</>;
}
