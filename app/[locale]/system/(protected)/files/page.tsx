import { unstable_noStore } from "next/cache";

import { FilesClient } from "@/components/system/FilesClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function FilesPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  return <FilesClient locale={locale} />;
}

