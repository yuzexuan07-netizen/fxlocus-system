import React from "react";
import { unstable_noStore } from "next/cache";

import { requireAssistant } from "@/lib/system/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AssistantLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { locale: "zh" | "en" };
}) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  await requireAssistant(locale);
  return <>{children}</>;
}
