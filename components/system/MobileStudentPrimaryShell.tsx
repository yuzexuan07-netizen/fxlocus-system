"use client";

import React from "react";
import { usePathname } from "next/navigation";

import { ConsultClient } from "@/components/system/ConsultClient";
import type { ConsultClientProps } from "@/components/system/ConsultClient";
import { NotificationsClient } from "@/components/system/NotificationsClient";
import { ProfileClient } from "@/components/system/ProfileClient";
import { AdminCourseAccessClient } from "@/components/system/admin/AdminCourseAccessClient";
import { AdminTradeSubmissionsClient } from "@/components/system/admin/AdminTradeSubmissionsClient";
import {
  getMobileApprovalBasePath,
  getMobilePrimaryTabSnapshot,
  getMobileRolePrimaryHrefs,
  isMobileApprovalRole,
  normalizeMobileTabPathname,
  sanitizeMobilePrimaryTabHref,
  setMobilePrimaryTabHref,
  subscribeMobilePrimaryTab,
  type MobilePrimaryTabHref
} from "@/lib/system/mobilePrimaryTabs";
import { MOBILE_STORE_CLOUD_PC } from "@/lib/system/mobileStore";

type Props = {
  locale: "zh" | "en";
  user: {
    id: string;
    full_name: string | null;
    email: string;
    phone: string | null;
    role: "student" | "trader" | "coach" | "assistant" | "leader" | "super_admin";
    status: "active" | "frozen" | "deleted";
    student_status: string | null;
    leader_id: string | null;
  };
  children: React.ReactNode;
  consultInitial?: Pick<ConsultClientProps, "initialRecipients" | "initialUnreadByPeer" | "initialLatestByPeer">;
  serverMobileApp?: boolean;
};

function useMobilePrimaryHref(role: string, fallback: MobilePrimaryTabHref) {
  const readSnapshot = React.useCallback(() => getMobilePrimaryTabSnapshot(role, fallback), [fallback, role]);
  const [href, setHref] = React.useState<MobilePrimaryTabHref>(() =>
    typeof window === "undefined" ? fallback : readSnapshot()
  );

  React.useEffect(() => {
    const sync = () => setHref(readSnapshot());
    sync();
    return subscribeMobilePrimaryTab(sync);
  }, [readSnapshot]);

  return href;
}

function MobileStorePanel({ locale }: { locale: "zh" | "en" }) {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const t =
    locale === "zh"
      ? {
          title: "商城",
          subtitle: "当前开放训练云电脑购买。",
          detail: "查看购买说明",
          pricePrefix: "现价",
          back: "返回商城",
          notesTitle: "购买说明",
          payTitle: "支付方式",
          waiting: "支付链接待配置",
          waitingHint: "补充微信 / 支付宝支付链接后，这里即可直接发起支付。",
          wechat: "微信支付",
          alipay: "支付宝支付"
        }
      : {
          title: "Store",
          subtitle: "Training cloud PC is currently available.",
          detail: "View details",
          pricePrefix: "Price",
          back: "Back to store",
          notesTitle: "Purchase notes",
          payTitle: "Payment methods",
          waiting: "Payment link pending",
          waitingHint: "Add WeChat / Alipay payment links to enable direct payment.",
          wechat: "WeChat Pay",
          alipay: "Alipay"
        };

  const title = locale === "zh" ? MOBILE_STORE_CLOUD_PC.title : "Tianyi Cloud Training PC";
  const subtitle = locale === "zh" ? MOBILE_STORE_CLOUD_PC.subtitle : "30-day training cloud PC";
  const notes =
    locale === "zh"
      ? MOBILE_STORE_CLOUD_PC.notes
      : [
          "No refunds after purchase.",
          "Any delay caused by leave or personal schedule is borne by the buyer.",
          "Each student can purchase at most two times.",
          "Confirm your training schedule before placing the order."
        ];
  const priceUnit = locale === "zh" ? MOBILE_STORE_CLOUD_PC.priceUnit : "CNY / 30 days";
  const paymentButtons = [
    { label: t.wechat, href: MOBILE_STORE_CLOUD_PC.wechatPayUrl },
    { label: t.alipay, href: MOBILE_STORE_CLOUD_PC.alipayUrl }
  ];
  const hasLivePayment = paymentButtons.some((item) => Boolean(item.href));

  if (detailOpen) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[860px] flex-col gap-4 pb-28">
        <button
          type="button"
          onClick={() => setDetailOpen(false)}
          className="inline-flex w-fit items-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/72 transition hover:bg-white/[0.08]"
        >
          {t.back}
        </button>

        <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,22,33,0.98),rgba(11,15,24,0.98))] shadow-[0_18px_44px_rgba(0,0,0,0.28)]">
          <div className="relative h-[240px] w-full border-b border-white/8 bg-[#0e1420]">
            <img src={MOBILE_STORE_CLOUD_PC.image} alt={title} className="h-full w-full object-cover" />
          </div>

          <div className="px-5 py-5">
            <div className="text-[24px] font-semibold text-white">{title}</div>
            <div className="mt-2 text-base text-white/58">{subtitle}</div>
            <div className="mt-4 inline-flex items-baseline gap-2 whitespace-nowrap text-[28px] font-semibold text-sky-300">
              <span>{MOBILE_STORE_CLOUD_PC.price}</span>
              <span className="text-base text-white/58">{priceUnit}</span>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/8 bg-[rgba(12,16,25,0.96)] p-5 shadow-[0_18px_44px_rgba(0,0,0,0.2)]">
          <h2 className="text-[18px] font-semibold text-white">{t.notesTitle}</h2>
          <div className="mt-4 space-y-3">
            {notes.map((note, index) => (
              <div
                key={note}
                className="flex items-start gap-3 rounded-[18px] border border-white/7 bg-white/[0.03] px-4 py-3"
              >
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

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[860px] flex-col gap-4 pb-28">
      <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,22,33,0.98),rgba(11,15,24,0.98))] shadow-[0_18px_44px_rgba(0,0,0,0.28)]">
        <div className="px-5 pb-3 pt-5">
          <h1 className="text-[24px] font-semibold text-white">{t.title}</h1>
          <p className="mt-1 text-sm text-white/52">{t.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="mx-3 mb-3 flex w-[calc(100%-24px)] items-stretch gap-4 rounded-[24px] border border-white/8 bg-white/[0.04] p-3 text-left transition hover:border-sky-300/30 hover:bg-white/[0.06]"
        >
          <div className="relative h-[132px] w-[124px] shrink-0 overflow-hidden rounded-[20px] border border-white/8 bg-[#0e1420]">
            <img src={MOBILE_STORE_CLOUD_PC.image} alt={title} className="h-full w-full object-cover" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
            <div>
              <div className="text-[18px] font-semibold text-white">{title}</div>
              <div className="mt-2 text-sm leading-6 text-white/60">{subtitle}</div>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.2em] text-white/35">{t.pricePrefix}</div>
                <div className="mt-1 inline-flex items-baseline gap-2 whitespace-nowrap text-[22px] font-semibold text-sky-300">
                  <span>{MOBILE_STORE_CLOUD_PC.price}</span>
                  <span className="text-sm text-white/58">{priceUnit}</span>
                </div>
              </div>
              <span className="inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-sky-300/24 bg-sky-400/10 px-3 py-3 text-center text-[13px] font-medium leading-4 text-sky-100">
                {t.detail}
              </span>
            </div>
          </div>
        </button>
      </section>
    </div>
  );
}

export function MobileStudentPrimaryShell({ locale, user, children, consultInitial, serverMobileApp = false }: Props) {
  const pathname = usePathname() || `/${locale}/system/notifications`;
  const [enabled, setEnabled] = React.useState(serverMobileApp);
  const normalizedPathname = normalizeMobileTabPathname(pathname);
  const approvalBasePath = getMobileApprovalBasePath(user.role);
  const approvalTradeLogHref = `${approvalBasePath}/trade-logs` as MobilePrimaryTabHref;
  const approvalCourseHref = `${approvalBasePath}/courses` as MobilePrimaryTabHref;
  const isApprovalRole = isMobileApprovalRole(user.role);
  const primaryPathFromUrl = sanitizeMobilePrimaryTabHref(normalizedPathname, user.role);
  const activeHref = useMobilePrimaryHref(user.role, primaryPathFromUrl || "/system/notifications");
  const [mountedTabs, setMountedTabs] = React.useState<Set<MobilePrimaryTabHref>>(
    () => new Set(getMobileRolePrimaryHrefs(user.role))
  );

  React.useEffect(() => {
    if (serverMobileApp) {
      setEnabled(true);
      return;
    }
    const sync = () => {
      setEnabled(document.documentElement.getAttribute("data-mobile-app") === "1");
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("pageshow", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, [serverMobileApp]);

  React.useEffect(() => {
    if (!enabled || !primaryPathFromUrl) return;
    setMobilePrimaryTabHref(primaryPathFromUrl, { locale, role: user.role, replaceUrl: false });
  }, [enabled, locale, primaryPathFromUrl, user.role]);

  React.useEffect(() => {
    setMountedTabs((prev) => (prev.has(activeHref) ? prev : new Set(prev).add(activeHref)));
  }, [activeHref]);

  React.useEffect(() => {
    setMountedTabs(new Set(getMobileRolePrimaryHrefs(user.role)));
  }, [user.role]);

  if (!enabled) {
    return <>{children}</>;
  }

  const initialMeRole = user.role === "leader" || user.role === "super_admin" ? user.role : null;
  const profileStatus = user.status === "frozen" ? "frozen" : "active";
  const mobileScrollStyle = { WebkitOverflowScrolling: "touch" as const };

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {mountedTabs.has("/system/notifications") ? (
        <div
          style={{ display: activeHref === "/system/notifications" ? "block" : "none", ...mobileScrollStyle }}
          className="absolute inset-0 overflow-y-auto overscroll-contain"
        >
          <NotificationsClient locale={locale} initialUserId={user.id} initialMeRole={initialMeRole} />
        </div>
      ) : null}

      {mountedTabs.has("/system/consult") ? (
        <div
          style={{ display: activeHref === "/system/consult" ? "flex" : "none" }}
          className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
        >
          <ConsultClient
            locale={locale}
            initialMeId={user.id}
            initialRecipients={consultInitial?.initialRecipients}
            initialUnreadByPeer={consultInitial?.initialUnreadByPeer}
            initialLatestByPeer={consultInitial?.initialLatestByPeer}
            forceMobileApp
          />
        </div>
      ) : null}

      {mountedTabs.has("/system/store") ? (
        <div
          style={{ display: !isApprovalRole && activeHref === "/system/store" ? "block" : "none", ...mobileScrollStyle }}
          className="absolute inset-0 overflow-y-auto overscroll-contain"
        >
          <MobileStorePanel locale={locale} />
        </div>
      ) : null}

      {isApprovalRole && mountedTabs.has(approvalTradeLogHref) ? (
        <div
          style={{ display: activeHref === approvalTradeLogHref ? "block" : "none", ...mobileScrollStyle }}
          className="absolute inset-0 overflow-y-auto overscroll-contain"
        >
          <AdminTradeSubmissionsClient locale={locale} type="trade_log" />
        </div>
      ) : null}

      {isApprovalRole && mountedTabs.has(approvalCourseHref) ? (
        <div
          style={{ display: activeHref === approvalCourseHref ? "block" : "none", ...mobileScrollStyle }}
          className="absolute inset-0 overflow-y-auto overscroll-contain"
        >
          <AdminCourseAccessClient locale={locale} />
        </div>
      ) : null}

      {mountedTabs.has("/system/profile") ? (
        <div
          style={{ display: activeHref === "/system/profile" ? "block" : "none", ...mobileScrollStyle }}
          className="absolute inset-0 overflow-y-auto overscroll-contain"
        >
          <ProfileClient
            locale={locale}
            initialMe={{
              ok: true,
              user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                status: profileStatus,
                student_status: user.student_status,
                leader_id: user.leader_id
              }
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
