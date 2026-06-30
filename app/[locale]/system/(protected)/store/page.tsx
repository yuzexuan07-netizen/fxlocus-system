import Image from "next/image";
import Link from "next/link";
import { unstable_noStore } from "next/cache";
import { redirect } from "next/navigation";

import { MOBILE_STORE_CLOUD_PC } from "@/lib/system/mobileStore";
import { requireSystemUser } from "@/lib/system/auth";
import { isMobileAppRequest } from "@/lib/system/mobileApp";

export default async function StorePage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params?.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  if (isMobileAppRequest()) {
    if (user.role === "assistant") redirect(`/${locale}/system/assistant/trade-logs`);
    if (user.role === "leader" || user.role === "super_admin") redirect(`/${locale}/system/admin/trade-logs`);
  }
  const t =
    locale === "zh"
      ? {
          title: "商城",
          subtitle: "当前开放训练云电脑购买。",
          detail: "查看购买说明",
          pricePrefix: "现价"
        }
      : {
          title: "Store",
          subtitle: "Training cloud PC is currently available.",
          detail: "View details",
          pricePrefix: "Price"
        };

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 pb-28">
      <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,22,33,0.98),rgba(11,15,24,0.98))] shadow-[0_18px_44px_rgba(0,0,0,0.28)]">
        <div className="px-5 pb-3 pt-5">
          <h1 className="text-[24px] font-semibold text-white">{t.title}</h1>
          <p className="mt-1 text-sm text-white/52">{t.subtitle}</p>
        </div>

        <Link
          href={`/${locale}/system/store/${MOBILE_STORE_CLOUD_PC.slug}`}
          className="mx-3 mb-3 flex items-stretch gap-4 rounded-[24px] border border-white/8 bg-white/[0.04] p-3 transition hover:border-sky-300/30 hover:bg-white/[0.06]"
        >
          <div className="relative h-[132px] w-[124px] shrink-0 overflow-hidden rounded-[20px] border border-white/8 bg-[#0e1420]">
            <Image src={MOBILE_STORE_CLOUD_PC.image} alt={MOBILE_STORE_CLOUD_PC.title} fill className="object-cover" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
            <div>
              <div className="text-[18px] font-semibold text-white">{MOBILE_STORE_CLOUD_PC.title}</div>
              <div className="mt-2 text-sm leading-6 text-white/60">{MOBILE_STORE_CLOUD_PC.subtitle}</div>
            </div>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-white/35">{t.pricePrefix}</div>
                <div className="mt-1 text-[22px] font-semibold text-sky-300">
                  {MOBILE_STORE_CLOUD_PC.price}
                  <span className="ml-1 text-sm text-white/58">{MOBILE_STORE_CLOUD_PC.priceUnit}</span>
                </div>
              </div>
              <span className="rounded-full border border-sky-300/24 bg-sky-400/10 px-3 py-2 text-xs font-medium text-sky-100">
                {t.detail}
              </span>
            </div>
          </div>
        </Link>
      </section>
    </div>
  );
}
