import React from "react";
import { unstable_noStore } from "next/cache";

import { requireAdmin } from "@/lib/system/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { locale: "zh" | "en" };
}) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  await requireAdmin(locale);
  return <>{children}</>;
}

