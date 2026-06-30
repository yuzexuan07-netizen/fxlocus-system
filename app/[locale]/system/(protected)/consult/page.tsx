import { ConsultClient } from "@/components/system/ConsultClient";
import { requireSystemUser } from "@/lib/system/auth";
import { isMobileAppRequest } from "@/lib/system/mobileApp";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConsultPage({ params }: { params: { locale: "zh" | "en" } }) {
  const locale = params.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  const forceMobileApp = isMobileAppRequest();

  return (
    <ConsultClient
      locale={locale}
      initialMeId={user.id}
      forceMobileApp={forceMobileApp}
    />
  );
}
