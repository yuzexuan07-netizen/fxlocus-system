import { unstable_noStore } from "next/cache";

import { AdminSettingsClient } from "@/components/system/admin/AdminSettingsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminSettingsPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";

  return (
    <div className="space-y-6">
      <AdminSettingsClient locale={locale} />
    </div>
  );
}
