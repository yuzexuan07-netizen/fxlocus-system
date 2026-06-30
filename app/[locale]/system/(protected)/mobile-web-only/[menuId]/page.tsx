import { Smartphone, ArrowLeft } from "lucide-react";
import { unstable_noStore } from "next/cache";

import { Link } from "@/i18n/navigation";
import { requireSystemUser } from "@/lib/system/auth";
import { getMobileWebOnlyMenuMeta } from "@/lib/system/mobileWebOnlyMenus";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MobileWebOnlyMenuPage({
  params
}: {
  params: { locale: "zh" | "en"; menuId: string };
}) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  await requireSystemUser(locale);

  const meta = getMobileWebOnlyMenuMeta(params.menuId);
  const title = meta ? (locale === "zh" ? meta.zh : meta.en) : locale === "zh" ? "更多功能" : "More";

  return (
    <div className="system-mobile-web-only mx-auto flex min-h-[calc(100dvh-var(--system-topbar-height)-var(--mobile-system-nav-height)-24px)] max-w-xl items-center justify-center">
      <section className="w-full rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(18,25,40,0.94),rgba(9,14,25,0.98))] p-6 text-center shadow-[0_24px_70px_rgba(0,0,0,0.38)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-sky-400/25 bg-sky-400/10 text-sky-200">
          <Smartphone className="h-8 w-8" />
        </div>
        <div className="mt-4 text-xl font-semibold text-white">{title}</div>
        <div className="mt-3 text-sm leading-7 text-white/68">
          {locale === "zh" ? "更多功能请访问网页端" : "Please access this feature on the web version."}
        </div>
        <div className="mt-2 text-xs leading-6 text-white/45">
          {locale === "zh"
            ? "手机端当前优先提供通知、咨询、商城和个人中心。"
            : "The mobile app currently focuses on notifications, consult, store, and profile."}
        </div>
        <div className="mt-6 flex justify-center">
          <Link
            href="/system/notifications"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-white/8 px-4 py-2.5 text-sm text-white/84 transition hover:bg-white/12"
          >
            <ArrowLeft className="h-4 w-4" />
            {locale === "zh" ? "返回移动端首页" : "Back to mobile home"}
          </Link>
        </div>
      </section>
    </div>
  );
}
