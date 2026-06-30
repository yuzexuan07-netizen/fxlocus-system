"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Ellipsis,
  FileText,
  FolderDown,
  ImageUp,
  LayoutDashboard,
  Lightbulb,
  MessageCircle,
  ShoppingBag,
  TrendingUp,
  UploadCloud,
  User,
  X
} from "lucide-react";

import { fetchSystemJson } from "@/lib/system/clientFetch";
import { SYSTEM_REALTIME_EVENT, type SystemRealtimeDetail } from "@/lib/system/realtime";
import {
  getMobileApprovalBasePath,
  getMobilePrimaryTabSnapshot,
  isMobileApprovalRole,
  isMobilePrimaryTabHref,
  normalizeMobileTabPathname,
  setMobilePrimaryTabHref,
  subscribeMobilePrimaryTab,
  type MobilePrimaryTabHref
} from "@/lib/system/mobilePrimaryTabs";
import { getMobileWebOnlyMenuMeta, type MobileWebOnlyMenuId } from "@/lib/system/mobileWebOnlyMenus";

type Props = {
  locale: "zh" | "en";
  user: {
    role: string;
    student_status: string | null;
  };
  forceMobileApp?: boolean;
};

type PrimaryItem = {
  href: string;
  zh: string;
  en: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
};

function isActive(pathname: string, href: string) {
  return normalizeMobileTabPathname(pathname) === normalizeMobileTabPathname(href);
}

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

export function MobileStudentNav({ locale, user, forceMobileApp = false }: Props) {
  const pathname = usePathname() || `/${locale}/system/notifications`;
  const router = useRouter();
  const [mounted, setMounted] = React.useState(forceMobileApp);
  const [open, setOpen] = React.useState(false);
  const [unread, setUnread] = React.useState(0);
  const [consultUnread, setConsultUnread] = React.useState(0);
  const [tradeLogPending, setTradeLogPending] = React.useState(0);
  const [coursePending, setCoursePending] = React.useState(0);
  const consultUnreadRef = React.useRef(0);
  const consultUnreadInitRef = React.useRef(false);
  const suppressCountIncreaseUntilRef = React.useRef(0);
  const audioRef = React.useRef<AudioContext | null>(null);

  React.useEffect(() => {
    if (forceMobileApp) {
      setMounted(true);
      return;
    }
    setMounted(document.documentElement.getAttribute("data-mobile-app") === "1");
  }, [forceMobileApp]);

  const activeHref = useMobilePrimaryHref(user.role, "/system/notifications");

  React.useEffect(() => {
    setOpen(false);
  }, [activeHref, pathname]);

  React.useEffect(() => {
    if (!mounted) return;
    const approvalBasePath = getMobileApprovalBasePath(user.role);
    const hrefs = [
      `/${locale}/system/notifications`,
      `/${locale}/system/consult`,
      isMobileApprovalRole(user.role) ? `/${locale}${approvalBasePath}/trade-logs` : `/${locale}/system/store`,
      ...(isMobileApprovalRole(user.role) ? [`/${locale}${approvalBasePath}/courses`] : []),
      `/${locale}/system/profile`
    ];
    hrefs.forEach((href) => {
      try {
        router.prefetch(href);
      } catch {
        // ignore
      }
    });
  }, [locale, mounted, router, user.role]);

  React.useEffect(() => {
    if (!mounted) return;
    let alive = true;
    let timer: number | null = null;

    const load = async (fresh = false) => {
      try {
        const result = await fetchSystemJson<{
          ok?: boolean;
          unread?: number;
          consultUnread?: number;
          pending?: Record<string, number>;
        }>(
          fresh ? "/api/system/sidebar-counts?fresh=1&hard=1" : "/api/system/sidebar-counts?fresh=1",
          {
            fresh,
            dedupeKey: fresh ? "mobile:student-nav:counts:fresh" : "mobile:student-nav:counts",
            retries: 1,
            retryBaseMs: 220,
            retryMaxMs: 900,
            dedupeWindowMs: fresh ? 0 : 250,
            preferStale: false,
            revalidateInBackground: false,
            staleTtlMs: 0
          }
        );
        const json = (result.body || null) as any;
        if (!alive || !result.ok || !json?.ok) return;
        const nextUnread = Math.max(0, Number(json.unread || 0));
        const nextConsultUnread = Math.max(0, Number(json.consultUnread || 0));
        const pending = json.pending && typeof json.pending === "object" ? json.pending : {};
        const nextTradeLogPending = Math.max(0, Number(pending.tradeLogs || 0));
        const nextCoursePending = Math.max(0, Number(pending.courseAccess || 0));
        const suppressIncrease = Date.now() < suppressCountIncreaseUntilRef.current;
        setUnread((prev) => (suppressIncrease && nextUnread > prev ? prev : nextUnread));
        setConsultUnread((prev) => (suppressIncrease && nextConsultUnread > prev ? prev : nextConsultUnread));
        setTradeLogPending(nextTradeLogPending);
        setCoursePending(nextCoursePending);
      } catch {
        // ignore
      }
    };

    const schedule = () => {
      if (!alive) return;
      timer = window.setTimeout(async () => {
        await load(true);
        schedule();
      }, 650);
    };

    const onRealtime = (event: Event) => {
      const detail = (event as CustomEvent<SystemRealtimeDetail>).detail || {};
      const delta = detail.sidebarDelta;
      if (delta) {
        const holdMs = Math.max(450, Number(delta.holdMs || 0));
        suppressCountIncreaseUntilRef.current = Math.max(suppressCountIncreaseUntilRef.current, Date.now() + holdMs);
        if (typeof delta.unread === "number") {
          setUnread((prev) => Math.max(0, prev + Number(delta.unread || 0)));
        }
        if (typeof delta.consultUnread === "number") {
          setConsultUnread((prev) => Math.max(0, prev + Number(delta.consultUnread || 0)));
        }
      }
      if (detail.table === "notifications" || detail.table === "consult_messages" || detail.table === "sidebar_counts") {
        void load(true);
      }
    };
    const onFocus = () => void load(true);
    const onVisibility = () => {
      if (!document.hidden) void load(true);
    };

    void load(true);
    schedule();
    window.addEventListener(SYSTEM_REALTIME_EVENT, onRealtime as EventListener);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener(SYSTEM_REALTIME_EVENT, onRealtime as EventListener);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mounted]);

  const primeAudio = React.useCallback(async () => {
    try {
      const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return null;
      const ctx: AudioContext = audioRef.current || new AudioContextCtor();
      audioRef.current = ctx;
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => null);
      }
      return ctx;
    } catch {
      return null;
    }
  }, []);

  React.useEffect(() => {
    if (!mounted) return;
    const unlock = () => {
      void primeAudio();
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [mounted, primeAudio]);

  const playIncomingAlert = React.useCallback(async () => {
    try {
      const globalKey = "__fx_last_mobile_consult_alert_at";
      const now = Date.now();
      const w = window as any;
      const last = Number(w[globalKey] || 0);
      if (last && now - last < 900) return;
      w[globalKey] = now;

      const ctx = await primeAudio();
      if (ctx && ctx.state === "running") {
        const steps = [
          { freq: 1046, duration: 0.08, gain: 0.16 },
          { freq: 1318, duration: 0.08, gain: 0.15 },
          { freq: 1568, duration: 0.14, gain: 0.18 }
        ];
        let cursor = ctx.currentTime;
        steps.forEach((step) => {
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = "triangle";
          oscillator.frequency.value = step.freq;
          gain.gain.setValueAtTime(0.0001, cursor);
          gain.gain.exponentialRampToValueAtTime(step.gain, cursor + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, cursor + step.duration);
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start(cursor);
          oscillator.stop(cursor + step.duration + 0.01);
          cursor += step.duration + 0.03;
        });
      }
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([160, 70, 220]);
      }
    } catch {
      // ignore
    }
  }, [primeAudio]);

  React.useEffect(() => {
    if (!mounted) return;
    if (!consultUnreadInitRef.current) {
      consultUnreadRef.current = consultUnread;
      consultUnreadInitRef.current = true;
      return;
    }
    if (consultUnread > consultUnreadRef.current) {
      void playIncomingAlert();
    }
    consultUnreadRef.current = consultUnread;
  }, [consultUnread, mounted, playIncomingAlert]);

  const showStudentUploads = user.role === "student" && user.student_status === "普通学员";
  const showTradeMenus = user.role === "student" || user.role === "trader" || user.role === "leader";
  const showClassicTrades = showTradeMenus;
  const isApprovalRole = isMobileApprovalRole(user.role);
  const approvalBasePath = getMobileApprovalBasePath(user.role);

  const primaryItems = React.useMemo(
    () => {
      const baseItems: PrimaryItem[] = [
        { href: "/system/notifications", zh: "通知", en: "Notifications", icon: Bell, badge: unread },
        { href: "/system/consult", zh: "咨询", en: "Consult", icon: MessageCircle, badge: consultUnread }
      ];
      if (isApprovalRole) {
        baseItems.push(
          {
            href: `${approvalBasePath}/trade-logs`,
            zh: "日志",
            en: "Logs",
            icon: FileText,
            badge: tradeLogPending
          },
          {
            href: `${approvalBasePath}/courses`,
            zh: "课程",
            en: "Courses",
            icon: BookOpen,
            badge: coursePending
          }
        );
      } else {
        baseItems.push({
          href: "/system/store",
          zh: "商城",
          en: "Store",
          icon: ShoppingBag
        });
      }
      baseItems.push({ href: "/system/profile", zh: "我的", en: "Profile", icon: User });
      return baseItems;
    },
    [approvalBasePath, consultUnread, coursePending, isApprovalRole, tradeLogPending, unread]
  );

  const moreItems = React.useMemo(() => {
    const items = [
      { id: "dashboard", icon: LayoutDashboard },
      { id: "courses", icon: BookOpen },
      ...(showStudentUploads ? ([{ id: "uploads", icon: UploadCloud }] as const) : []),
      { id: "files", icon: FolderDown },
      ...(showTradeMenus
        ? ([
            { id: "trade-logs", icon: FileText },
            { id: "trade-strategies", icon: Lightbulb }
          ] as const)
        : []),
      ...(showClassicTrades ? ([{ id: "classic-trades", icon: ImageUp }] as const) : []),
      ...(showTradeMenus ? ([{ id: "weekly-summaries", icon: BookOpen }] as const) : []),
      { id: "today-data", icon: CalendarDays },
      { id: "ladder", icon: TrendingUp }
    ];

    return items.map((item) => ({
      ...item,
      id: item.id as MobileWebOnlyMenuId,
      meta: getMobileWebOnlyMenuMeta(item.id)
    }));
  }, [showClassicTrades, showStudentUploads, showTradeMenus]);

  const navigateTo = React.useCallback(
    (href: string) => {
      const target = normalizeMobileTabPathname(href);
      const current = normalizeMobileTabPathname(activeHref);
      setOpen(false);
      const canVirtualSwitch = (forceMobileApp || mounted) && isMobilePrimaryTabHref(target);

      if (target === current) {
        if (canVirtualSwitch) {
          setMobilePrimaryTabHref(target, { locale, role: user.role });
        }
        return;
      }

      if (canVirtualSwitch) {
        setMobilePrimaryTabHref(target, { locale, role: user.role });
        return;
      }

      router.push(`/${locale}${href}`);
    },
    [activeHref, forceMobileApp, locale, mounted, router, user.role]
  );

  if (!mounted) return null;

  const activePath = normalizeMobileTabPathname(activeHref || pathname);

  return (
    <>
      <nav
        className="system-mobile-nav"
        aria-label={locale === "zh" ? "移动端主导航" : "Mobile main navigation"}
        style={{ gridTemplateColumns: `repeat(${primaryItems.length + 1}, minmax(0, 1fr))` }}
      >
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(activePath, item.href);
          return (
            <button
              key={item.href}
              type="button"
              onClick={() => navigateTo(item.href)}
              className={["system-mobile-nav-item", active ? "is-active" : ""].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              <span className="system-mobile-nav-icon-wrap">
                <Icon className="system-mobile-nav-icon" />
                {typeof item.badge === "number" && item.badge > 0 ? (
                  <span className="system-mobile-nav-badge">{item.badge > 99 ? "99+" : String(item.badge)}</span>
                ) : null}
              </span>
              <span className="system-mobile-nav-label">{locale === "zh" ? item.zh : item.en}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setOpen(true)}
          className={["system-mobile-nav-item", open ? "is-active" : ""].join(" ")}
          aria-expanded={open}
        >
          <span className="system-mobile-nav-icon-wrap">
            <Ellipsis className="system-mobile-nav-icon" />
          </span>
          <span className="system-mobile-nav-label">{locale === "zh" ? "更多" : "More"}</span>
        </button>
      </nav>

      {open ? (
        <div className="system-mobile-more-layer">
          <button
            type="button"
            className="system-mobile-more-backdrop"
            aria-label={locale === "zh" ? "关闭更多菜单" : "Close more menu"}
            onClick={() => setOpen(false)}
          />
          <div className="system-mobile-more-sheet">
            <div className="system-mobile-more-head">
              <div>
                <div className="text-base font-semibold text-white">{locale === "zh" ? "更多功能" : "More"}</div>
                <div className="mt-1 text-xs text-white/48">
                  {locale === "zh"
                    ? "这些入口会跳转到网页端提示页。"
                    : "These entries open a web-only notice page."}
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="system-mobile-more-close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="system-mobile-more-grid">
              {moreItems.map((item) => {
                const meta = item.meta;
                if (!meta) return null;
                const Icon = item.icon;
                const href = `/system/mobile-web-only/${item.id}`;
                const active = isActive(activePath, href);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTo(href)}
                    className={["system-mobile-more-item", active ? "is-active" : ""].join(" ")}
                  >
                    <span className="system-mobile-more-icon">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="system-mobile-more-title">{locale === "zh" ? meta.zh : meta.en}</span>
                    <span className="system-mobile-more-subtitle">
                      {locale === "zh" ? "更多功能请访问网页端" : "Please use the web version"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
