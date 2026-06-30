import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MOBILE_STORE_CLOUD_PC } from "@/lib/system/mobileStore";

export default function StoreDetailPage({
  params
}: {
  params: { locale: "zh" | "en"; slug: string };
}) {
  const locale = params?.locale === "en" ? "en" : "zh";
  const slug = String(params?.slug || "");
  if (slug !== MOBILE_STORE_CLOUD_PC.slug) notFound();

  const t =
    locale === "zh"
      ? {
          back: "返回商城",
          notesTitle: "购买说明",
          payTitle: "支付方式",
          waiting: "支付链接待配置",
          waitingHint: "请补充微信 / 支付宝支付链接后即可直接跳转支付。",
          wechat: "微信支付",
          alipay: "支付宝支付"
        }
      : {
          back: "Back to store",
          notesTitle: "Purchase notes",
          payTitle: "Payment methods",
          waiting: "Payment link pending",
          waitingHint: "Add WeChat / Alipay payment links to enable direct payment.",
          wechat: "WeChat Pay",
          alipay: "Alipay"
        };

  const paymentButtons = [
    { label: t.wechat, href: MOBILE_STORE_CLOUD_PC.wechatPayUrl },
    { label: t.alipay, href: MOBILE_STORE_CLOUD_PC.alipayUrl }
  ];

  const hasLivePayment = paymentButtons.some((item) => Boolean(item.href));

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 pb-28">
      <Link
        href={`/${locale}/system/store`}
        className="inline-flex w-fit items-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/72 transition hover:bg-white/[0.08]"
      >
        {t.back}
      </Link>

      <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,22,33,0.98),rgba(11,15,24,0.98))] shadow-[0_18px_44px_rgba(0,0,0,0.28)]">
        <div className="relative h-[240px] w-full border-b border-white/8 bg-[#0e1420]">
          <Image src={MOBILE_STORE_CLOUD_PC.image} alt={MOBILE_STORE_CLOUD_PC.title} fill className="object-cover" />
        </div>

        <div className="px-5 py-5">
          <div className="text-[24px] font-semibold text-white">{MOBILE_STORE_CLOUD_PC.title}</div>
          <div className="mt-2 text-base text-white/58">{MOBILE_STORE_CLOUD_PC.subtitle}</div>
          <div className="mt-4 text-[28px] font-semibold text-sky-300">
            {MOBILE_STORE_CLOUD_PC.price}
            <span className="ml-2 text-base text-white/58">{MOBILE_STORE_CLOUD_PC.priceUnit}</span>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/8 bg-[rgba(12,16,25,0.96)] p-5 shadow-[0_18px_44px_rgba(0,0,0,0.2)]">
        <h2 className="text-[18px] font-semibold text-white">{t.notesTitle}</h2>
        <div className="mt-4 space-y-3">
          {MOBILE_STORE_CLOUD_PC.notes.map((note, index) => (
            <div key={note} className="flex items-start gap-3 rounded-[18px] border border-white/7 bg-white/[0.03] px-4 py-3">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-400/12 text-xs font-semibold text-sky-100">
                {index + 1}
              </span>
              <p className="text-sm leading-6 text-white/74">{note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/8 bg-[rgba(12,16,25,0.96)] p-5 shadow-[0_18px_44px_rgba(0,0,0,0.2)]">
        <h2 className="text-[18px] font-semibold text-white">{t.payTitle}</h2>
        {!hasLivePayment ? (
          <div className="mt-4 rounded-[18px] border border-amber-300/18 bg-amber-300/8 px-4 py-4">
            <div className="text-sm font-medium text-amber-100">{t.waiting}</div>
            <div className="mt-1 text-sm leading-6 text-white/60">{t.waitingHint}</div>
          </div>
        ) : null}
        <div className="mt-4 grid grid-cols-1 gap-3">
          {paymentButtons.map((item) =>
            item.href ? (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[54px] items-center justify-center rounded-[18px] border border-sky-300/22 bg-sky-400/10 px-4 text-sm font-medium text-sky-100 transition hover:bg-sky-400/16"
              >
                {item.label}
              </a>
            ) : (
              <div
                key={item.label}
                className="inline-flex min-h-[54px] items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.03] px-4 text-sm text-white/35"
              >
                {item.label}
              </div>
            )
          )}
        </div>
      </section>
    </div>
  );
}
