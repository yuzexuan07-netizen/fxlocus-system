"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FolderCog,
  FolderDown,
  Gauge,
  HandHeart,
  ImageUp,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Mail,
  MessageCircle,
  Settings,
  ShieldCheck,
  TrendingUp,
  UploadCloud,
  User,
  UserCog,
  Users
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import type { SystemUser } from "@/lib/system/auth";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";
import { stopSystemMusic } from "@/lib/system/musicControl";
import { isAdminRole, isLearnerRole } from "@/lib/system/roles";
import { SYSTEM_REALTIME_EVENT, type SidebarDelta, type SystemRealtimeDetail } from "@/lib/system/realtime";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import appPackage from "../../package.json";

type NavItem = {
  href: string;
  zh: string;
  en: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  badge?: number;
};

function normalizePathname(pathname: string) {
  const withoutLocale = pathname.replace(/^\/(zh|en)(?=\/|$)/, "");
  const withLeadingSlash = withoutLocale.startsWith("/") ? withoutLocale : `/${withoutLocale}`;
  const normalized = withLeadingSlash === "//" ? "/" : withLeadingSlash;
  if (normalized === "") return "/";
  if (normalized === "/") return "/";
  return normalized.replace(/\/+$/, "");
}

function isActive(pathname: string, item: NavItem) {
  const current = normalizePathname(pathname);
  const target = normalizePathname(item.href);
  if (item.exact) return current === target;
  return current === target || current.startsWith(`${target}/`);
}

function SidebarItem({
  locale,
  item,
  active,
  collapsed,
  onPrefetch
}: {
  locale: "zh" | "en";
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onPrefetch: (href: string) => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? (locale === "zh" ? item.zh : item.en) : undefined}
      prefetch={false}
      onMouseEnter={() => onPrefetch(item.href)}
      onFocus={() => onPrefetch(item.href)}
      className={[
        "sidebar-item group relative flex w-full items-center rounded-2xl border text-sm transition-colors",
        collapsed ? "justify-center" : "justify-start gap-3",
        active
          ? "bg-[color:var(--panel-2)] border-[color:var(--border-2)] text-white"
          : "bg-transparent border-[color:var(--border)] text-white/75 hover:bg-[color:var(--panel)] hover:text-white"
      ].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      {!collapsed ? (
        <span
          className={[
            "sidebar-item-indicator absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r",
            active ? "bg-sky-400" : "bg-transparent"
          ].join(" ")}
        />
      ) : null}
      <Icon
        className={[
          "sidebar-icon shrink-0",
          active ? "text-sky-200" : "text-white/70 group-hover:text-white"
        ].join(" ")}
      />

      {!collapsed ? <span className="min-w-0 truncate">{locale === "zh" ? item.zh : item.en}</span> : null}

      {typeof item.badge === "number" && item.badge > 0 ? (
        <span
          className={[
            "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500/90 px-1.5 text-[11px] font-semibold text-white",
            collapsed ? "absolute right-2 top-2" : "ml-auto"
          ].join(" ")}
        >
          {item.badge > 99 ? "99+" : String(item.badge)}
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar({
  locale,
  user,
  forceMobileApp = false,
  initialCollapsed = false
}: {
  locale: "zh" | "en";
  user: Pick<SystemUser, "role" | "student_status">;
  forceMobileApp?: boolean;
  initialCollapsed?: boolean;
}) {
  const pathname = usePathname() || `/${locale}/system/dashboard`;
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(initialCollapsed);
  const [sidebarMotion, setSidebarMotion] = React.useState<"collapse" | "expand" | null>(null);
  const [unread, setUnread] = React.useState(0);
  const [consultUnread, setConsultUnread] = React.useState(0);
  const [pending, setPending] = React.useState<Record<string, number>>({});
  const [trialEligible, setTrialEligible] = React.useState(false);
  const [desktopMeta, setDesktopMeta] = React.useState<{ version: string } | null>(null);
  const [desktopMetaError, setDesktopMetaError] = React.useState(false);
  const [desktopReadVersion, setDesktopReadVersion] = React.useState<string | null>(null);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const [isMobileApp, setIsMobileApp] = React.useState(forceMobileApp);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const aliveRef = React.useRef(true);
  const unreadHoldDownRef = React.useRef<{ value: number; exp: number } | null>(null);
  const consultUnreadHoldDownRef = React.useRef<{ value: number; exp: number } | null>(null);
  const pendingHoldDownRef = React.useRef<Map<string, { value: number; exp: number }>>(new Map());
  const prefetchedRef = React.useRef<Set<string>>(new Set());
  const prefetchQueueRef = React.useRef<string[]>([]);
  const prefetchTimerRef = React.useRef<number | null>(null);
  const sidebarWidth = collapsed ? "var(--system-sidebar-collapsed-width)" : "var(--system-sidebar-width)";
  const scrollKey = "fxlocus_system_sidebar_scroll";
  const desktopReadKey = "fxlocus_desktop_package_read_version";
  const appVersion = String(appPackage.version || "0.1.0");
  const SIDEBAR_HOLD_MS = 1_200;

  React.useEffect(() => {
    const stored = window.localStorage.getItem("fxlocus_system_sidebar_collapsed");
    setCollapsed(stored ? stored === "1" : initialCollapsed);
    if (forceMobileApp) {
      setIsMobileApp(true);
      return;
    }
    setIsMobileApp(document.documentElement.getAttribute("data-mobile-app") === "1");
  }, [forceMobileApp, initialCollapsed]);

  React.useEffect(() => {
    window.localStorage.setItem("fxlocus_system_sidebar_collapsed", collapsed ? "1" : "0");
    document.documentElement.setAttribute("data-system-sidebar-collapsed", collapsed ? "1" : "0");
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `fxlocus_system_sidebar_collapsed=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax${secure}`;
  }, [collapsed]);

  const toggleCollapsed = React.useCallback((next: boolean) => {
    setCollapsed((prev) => {
      if (prev === next) return prev;
      setSidebarMotion(next ? "collapse" : "expand");
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!sidebarMotion) return;
    const timer = window.setTimeout(() => setSidebarMotion(null), 560);
    return () => window.clearTimeout(timer);
  }, [sidebarMotion]);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(desktopReadKey);
    setDesktopReadVersion(stored);
  }, [desktopReadKey]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const stored = window.localStorage.getItem(scrollKey);
    if (stored) {
      const value = Number(stored);
      if (!Number.isNaN(value)) {
        el.scrollTop = value;
      }
    }
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const stored = window.localStorage.getItem(scrollKey);
    if (!stored) return;
    const value = Number(stored);
    if (Number.isNaN(value)) return;
    window.requestAnimationFrame(() => {
      el.scrollTop = value;
    });
  }, [pathname, collapsed]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      window.localStorage.setItem(scrollKey, String(el.scrollTop));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  const lastErrorRef = React.useRef(0);
  const authErrorBackoffUntilRef = React.useRef(0);
  const lastCountsFetchRef = React.useRef(0);
  const lastTrialFetchRef = React.useRef(0);
  const lastDesktopFetchRef = React.useRef(0);
  const SIDEBAR_ERROR_BACKOFF_MS = 6_000;
  const realtimeImmediateFreshTables = React.useMemo(
    () =>
      new Set([
        "sidebar_counts",
        "notifications",
        "consult_messages",
        "course_access",
        "file_access_requests",
        "trade_submissions",
        "classic_trades",
        "weekly_summaries",
        "course_notes",
        "ladder_authorizations",
        "student_documents",
        "records",
        "contact_submissions"
      ]),
    []
  );
  const shouldSkipFetch = React.useCallback((force = false) => {
    const now = Date.now();
    if (now < authErrorBackoffUntilRef.current) return true;
    if (force) return false;
    return now - lastErrorRef.current < SIDEBAR_ERROR_BACKOFF_MS;
  }, [SIDEBAR_ERROR_BACKOFF_MS]);

  const loadSidebarCounts = React.useCallback(async (force = false) => {
    if (shouldSkipFetch(force)) return;
    const now = Date.now();
    if (!force && now - lastCountsFetchRef.current < 4500) return;
    const globalSlotMs = force ? 1_600 : 12_000;
    if (!acquireGlobalPollSlot("system:sidebar-counts", globalSlotMs)) return;
    lastCountsFetchRef.current = now;
    try {
      const endpoint = force ? "/api/system/sidebar-counts?fresh=1" : "/api/system/sidebar-counts";
      const result = await fetchSystemJson<{
        ok?: boolean;
        unread?: number;
        consultUnread?: number;
        pending?: Record<string, number>;
      }>(endpoint, {
        dedupeKey: force ? `sidebar:counts:fresh:${user.role}` : `sidebar:counts:${user.role}`,
        retries: force ? 1 : 2,
        retryBaseMs: 260,
        retryMaxMs: 1200,
        dedupeWindowMs: force ? 250 : 1200,
        fresh: force,
        preferStale: false,
        revalidateInBackground: false,
        staleTtlMs: 0,
        allowStaleOnRateLimit: false,
        allowStaleOnServerError: false
      });
      const json = (result.body || null) as any;
      if (!aliveRef.current) return;
      if (!result.ok || !json?.ok) {
        const errCode = String(json?.error || result.errorCode || "");
        if (
          result.status === 401 ||
          result.status === 403 ||
          errCode === "UNAUTHORIZED" ||
          errCode === "FORBIDDEN" ||
          errCode === "FROZEN"
        ) {
          authErrorBackoffUntilRef.current = Date.now() + 5 * 60_000;
          lastErrorRef.current = Date.now();
          return;
        }
        if (result.status === 429 || errCode === "RATE_LIMITED" || errCode === "TOO_MANY_REQUESTS") {
          lastErrorRef.current = Date.now();
          return;
        }
        lastErrorRef.current = Date.now();
        return;
      }
      authErrorBackoffUntilRef.current = 0;
      const nextUnread = Math.max(0, Number(json.unread || 0));
      const nextConsultUnread = Math.max(0, Number(json.consultUnread || 0));
      const nextPending = (json.pending || {}) as Record<string, number>;
      const nowTs = Date.now();
      let stabilizedUnread = nextUnread;
      const unreadHold = unreadHoldDownRef.current;
      if (unreadHold) {
        if (unreadHold.exp <= nowTs) {
          unreadHoldDownRef.current = null;
        } else if (stabilizedUnread > unreadHold.value) {
          stabilizedUnread = unreadHold.value;
        } else {
          unreadHoldDownRef.current = null;
        }
      }
      let stabilizedConsultUnread = nextConsultUnread;
      const consultHold = consultUnreadHoldDownRef.current;
      if (consultHold) {
        if (consultHold.exp <= nowTs) {
          consultUnreadHoldDownRef.current = null;
        } else if (stabilizedConsultUnread > consultHold.value) {
          stabilizedConsultUnread = consultHold.value;
        } else {
          consultUnreadHoldDownRef.current = null;
        }
      }
      const holdDown = pendingHoldDownRef.current;
      const stabilizedPending: Record<string, number> = { ...nextPending };
      for (const [key, meta] of holdDown.entries()) {
        if (meta.exp <= nowTs) {
          holdDown.delete(key);
          continue;
        }
        const serverValue = Math.max(0, Number(stabilizedPending[key] || 0));
        if (serverValue > meta.value) {
          stabilizedPending[key] = meta.value;
        } else {
          holdDown.delete(key);
        }
      }
      setUnread(stabilizedUnread);
      setConsultUnread(stabilizedConsultUnread);
      setPending(stabilizedPending);
    } catch {
      lastErrorRef.current = Date.now();
    }
  }, [shouldSkipFetch, user.role]);

  const applySidebarDelta = React.useCallback((delta?: SidebarDelta | null) => {
    if (!delta || typeof delta !== "object") return;
    const holdMsRaw = Number(delta.holdMs || 0);
    const holdMs = Number.isFinite(holdMsRaw) && holdMsRaw > 0 ? holdMsRaw : SIDEBAR_HOLD_MS;
    const holdUntil = Date.now() + holdMs;

    const unreadDelta = Number(delta.unread || 0);
    if (Number.isFinite(unreadDelta) && unreadDelta !== 0) {
      setUnread((prev) => {
        const next = Math.max(0, Number(prev || 0) + unreadDelta);
        if (unreadDelta < 0) {
          unreadHoldDownRef.current = { value: next, exp: holdUntil };
        } else {
          unreadHoldDownRef.current = null;
        }
        return next;
      });
    }

    const consultDelta = Number(delta.consultUnread || 0);
    if (Number.isFinite(consultDelta) && consultDelta !== 0) {
      setConsultUnread((prev) => {
        const next = Math.max(0, Number(prev || 0) + consultDelta);
        if (consultDelta < 0) {
          consultUnreadHoldDownRef.current = { value: next, exp: holdUntil };
        } else {
          consultUnreadHoldDownRef.current = null;
        }
        return next;
      });
    }

    const pendingDelta = delta.pending && typeof delta.pending === "object" ? delta.pending : null;
    if (!pendingDelta) return;
    setPending((prev) => {
      const next: Record<string, number> = { ...prev };
      for (const [key, rawDiff] of Object.entries(pendingDelta)) {
        const diff = Number(rawDiff || 0);
        if (!Number.isFinite(diff) || diff === 0) continue;
        const current = Math.max(0, Number(next[key] || 0));
        const updated = Math.max(0, current + diff);
        next[key] = updated;
        if (diff < 0) {
          pendingHoldDownRef.current.set(key, { value: updated, exp: holdUntil });
        } else {
          pendingHoldDownRef.current.delete(key);
        }
      }
      return next;
    });
  }, [SIDEBAR_HOLD_MS]);

  const applyRecordsReadAction = React.useCallback((action: string) => {
    if (!action.startsWith("records_read:")) return;
    const recordType = action.split(":")[1];
    const pendingKey =
      recordType === "contact"
        ? "contacts"
        : recordType === "donate"
          ? "donations"
          : recordType === "enrollment"
            ? "enrollments"
            : "";
    if (!pendingKey) return;
    const holdUntil = Date.now() + SIDEBAR_HOLD_MS;
    setPending((prev) => {
      const current = Math.max(0, Number(prev?.[pendingKey] || 0));
      if (current <= 0) {
        pendingHoldDownRef.current.set(pendingKey, { value: 0, exp: holdUntil });
        return prev;
      }
      const nextValue = current - 1;
      pendingHoldDownRef.current.set(pendingKey, { value: nextValue, exp: holdUntil });
      return {
        ...prev,
        [pendingKey]: nextValue
      };
    });
  }, [SIDEBAR_HOLD_MS]);

  React.useEffect(() => {
    const onRealtime = (event: Event) => {
      const detail = (event as CustomEvent<SystemRealtimeDetail>).detail;
      applySidebarDelta(detail?.sidebarDelta);
      const table = String(detail?.table || "");
      const action = String(detail?.action || "");
      if (table === "sidebar_counts") {
        applyRecordsReadAction(action);
      }
    };
    window.addEventListener(SYSTEM_REALTIME_EVENT, onRealtime as EventListener);
    return () => {
      window.removeEventListener(SYSTEM_REALTIME_EVENT, onRealtime as EventListener);
    };
  }, [applyRecordsReadAction, applySidebarDelta]);

  const loadDesktopMeta = React.useCallback(async (force = false) => {
    if (user.role !== "super_admin") return;
    const now = Date.now();
    if (!force && now - lastDesktopFetchRef.current < 5 * 60_000) return;
    if (!force && !acquireGlobalPollSlot("desktop:latest", 120_000)) return;
    lastDesktopFetchRef.current = now;
    try {
      const result = await fetchSystemJson<{ ok?: boolean; version?: string }>("/api/system/desktop/latest?json=1", {
        dedupeKey: "desktop:latest",
        retries: 1,
        dedupeWindowMs: force ? 400 : 30_000,
        preferStale: !force,
        revalidateInBackground: !force,
        staleTtlMs: 10 * 60_000,
        allowStaleOnRateLimit: true
      });
      if (!result.ok) throw new Error("meta_missing");
      const data = (result.body || null) as any;
      if (!aliveRef.current) return;
      if (data?.ok && data?.version) {
        setDesktopMeta({ version: String(data.version) });
        setDesktopMetaError(false);
      } else {
        setDesktopMeta(null);
        setDesktopMetaError(true);
      }
    } catch {
      if (!aliveRef.current) return;
      setDesktopMeta(null);
      setDesktopMetaError(true);
    }
  }, [user.role]);

  const loadTrialEligible = React.useCallback(async () => {
    if (user.role !== "student") return;
    if (user.student_status !== "普通学员") {
      setTrialEligible(false);
      return;
    }
    const now = Date.now();
    if (now - lastTrialFetchRef.current < 5 * 60_000) return;
    if (!acquireGlobalPollSlot("system:trial-access-status", 120_000)) return;
    lastTrialFetchRef.current = now;
    try {
      const result = await fetchSystemJson<{ ok?: boolean; eligible?: boolean }>("/api/system/trial-access/status", {
        dedupeKey: "trial-access:status",
        retries: 1,
        dedupeWindowMs: 2000
      });
      const json = (result.body || null) as any;
      if (!aliveRef.current) return;
      if (!result.ok || !json?.ok) {
        setTrialEligible(false);
        return;
      }
      setTrialEligible(Boolean(json.eligible));
    } catch {
      setTrialEligible(false);
    }
  }, [user.role, user.student_status]);

  React.useEffect(() => {
    aliveRef.current = true;
    let pollTimer: number | null = null;
    const schedulePoll = (baseMs: number) => {
      if (!aliveRef.current) return;
      const jitterMs = Math.floor(baseMs * 0.2);
      const nextMs = baseMs + Math.floor(Math.random() * (jitterMs + 1));
      pollTimer = window.setTimeout(() => {
        if (!aliveRef.current) return;
        if (!document.hidden) {
          loadSidebarCounts(false);
          loadTrialEligible();
          loadDesktopMeta(false);
        }
        schedulePoll(baseMs);
      }, nextMs);
    };
    const onFocus = () => {
      if (document.hidden) return;
      loadSidebarCounts(true);
      loadTrialEligible();
      loadDesktopMeta(false);
    };

    loadSidebarCounts(true);
    loadTrialEligible();
    loadDesktopMeta(true);
    const pollMs =
      typeof navigator !== "undefined" && (navigator as any).connection?.saveData
        ? 90_000
        : 60_000;
    schedulePoll(pollMs);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const onDesktopRead = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.version) setDesktopReadVersion(String(detail.version));
    };
    window.addEventListener("fxdesktop:read", onDesktopRead as EventListener);
    return () => {
      aliveRef.current = false;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("fxdesktop:read", onDesktopRead as EventListener);
    };
  }, [loadSidebarCounts, loadTrialEligible, loadDesktopMeta]);

  useSystemRealtimeRefresh(
    (detail) => {
      const table = String(detail?.table || "");
      const force = table !== "" && realtimeImmediateFreshTables.has(table);
      void loadSidebarCounts(force);
    },
    {
      tables: [
        "sidebar_counts",
        "notifications",
        "consult_messages",
        "course_access",
        "file_access_requests",
        "trade_submissions",
        "classic_trades",
        "weekly_summaries",
        "course_notes",
        "ladder_authorizations",
        "student_documents",
        "records",
        "contact_submissions"
      ],
      includeSidebarCounts: true,
      throttleMs: 420,
      globalThrottleMs: 720,
      dedupeKey: "sidebar:counts"
    }
  );

  const localePrefix = React.useMemo(() => {
    const match = pathname.match(/^\/(zh|en)(?=\/|$)/);
    return match ? `/${match[1]}` : "";
  }, [pathname]);

  const prefetchRoute = React.useCallback(
    (href: string) => {
      if (!href || href.startsWith("#") || href.startsWith("?")) return;
      if (/^(https?:|mailto:|tel:)/.test(href)) return;
      const connection = typeof navigator !== "undefined" ? (navigator as any).connection : null;
      if (connection?.saveData) return;
      const networkType = String(connection?.effectiveType || "").toLowerCase();
      if (networkType.includes("2g")) return;
      const fullPath = `${localePrefix}${href}`;
      if (prefetchedRef.current.has(fullPath)) return;
      prefetchedRef.current.add(fullPath);
      prefetchQueueRef.current.push(fullPath);
      if (prefetchTimerRef.current !== null) return;
      const flush = () => {
        prefetchTimerRef.current = null;
        const next = prefetchQueueRef.current.shift();
        if (!next) return;
        try {
          router.prefetch(next);
        } catch {
          // ignore prefetch errors and continue
        }
        if (prefetchQueueRef.current.length) {
          prefetchTimerRef.current = window.setTimeout(flush, 140);
        }
      };
      prefetchTimerRef.current = window.setTimeout(flush, 100);
    },
    [localePrefix, router]
  );

  React.useEffect(() => {
    return () => {
      if (prefetchTimerRef.current !== null) {
        window.clearTimeout(prefetchTimerRef.current);
        prefetchTimerRef.current = null;
      }
      prefetchQueueRef.current = [];
    };
  }, []);

  const logout = async () => {
    setLoggingOut(true);
    try {
      stopSystemMusic({ resetSource: true, clearSavedState: true });
      await fetch("/api/system/auth/logout", { method: "POST" });
    } finally {
      router.replace(`/${locale}/system/login`);
      setLoggingOut(false);
    }
  };

  const showStudentUploads = user.role === "student" && user.student_status === "普通学员";
  const showTrialAccess = user.role === "student" && trialEligible;
  const showTradeMenus = (isLearnerRole(user.role) || user.role === "leader") && user.role !== "assistant";
  const showClassicTrades = (isLearnerRole(user.role) || user.role === "leader") && user.role !== "assistant";
  const useMobileLearnerNav = isMobileApp;
  const normalizedPath = normalizePathname(pathname);
  const consultBadge = normalizedPath === "/system/consult" ? 0 : consultUnread;
  const needsDesktopPackage = desktopMetaError || !desktopMeta || desktopMeta.version !== appVersion;
  const settingsBadge = user.role === "super_admin" && needsDesktopPackage && desktopReadVersion !== appVersion ? 1 : 0;

  const studentItems: NavItem[] = React.useMemo(
    () => [
      { href: "/system/dashboard", zh: "仪表盘", en: "Dashboard", icon: LayoutDashboard },
      ...(showTrialAccess
        ? ([
            {
              href: "/system/trial-access",
              zh: "系统接入：三日体验",
              en: "System Access: 3-day Trial",
              icon: ClipboardList
            }
          ] as NavItem[])
        : []),
      { href: "/system/courses", zh: "课程", en: "Courses", icon: BookOpen },
      ...(showStudentUploads
        ? ([{ href: "/system/uploads", zh: "资料上传", en: "Uploads", icon: UploadCloud }] as NavItem[])
        : []),
      { href: "/system/files", zh: "文件", en: "Files", icon: FolderDown },
      ...(showTradeMenus
        ? ([
            { href: "/system/trade-logs", zh: "模拟交易日志", en: "Simulation Trade Logs", icon: FileText },
            { href: "/system/trade-strategies", zh: "模拟交易策略", en: "Simulation Trade Strategies", icon: Lightbulb }
          ] as NavItem[])
        : []),
      ...(showClassicTrades
        ? ([{ href: "/system/classic-trades", zh: "模拟交易案例", en: "Simulation Trade Cases", icon: ImageUp }] as NavItem[])
        : []),
      ...((isLearnerRole(user.role) || user.role === "leader")
        ? ([{ href: "/system/weekly-summaries", zh: "周总结", en: "Weekly Summary", icon: ClipboardList }] as NavItem[])
        : []),
      { href: "/system/today-data", zh: "经济数据", en: "Economic Data", icon: CalendarDays },
      { href: "/system/notifications", zh: "通知", en: "Notifications", icon: Bell, badge: unread },
      { href: "/system/consult", zh: "咨询", en: "Consult", icon: MessageCircle, badge: consultBadge },
      { href: "/system/profile", zh: "个人资料", en: "Profile", icon: User },
      { href: "/system/ladder", zh: "天梯", en: "Ladder", icon: TrendingUp }
    ],
    [consultBadge, showClassicTrades, showStudentUploads, showTradeMenus, showTrialAccess, unread, user.role]
  );

  const adminItems: NavItem[] = React.useMemo(
    () => [
    { href: "/system/admin", zh: "管理概览", en: "Admin Home", icon: Gauge, exact: true },
    ...(user.role === "leader"
      ? ([
          { href: "/system/admin/my-leaders", zh: "我的团队长", en: "My Leaders", icon: UserCog },
          { href: "/system/admin/my-traders", zh: "我的数据采集员", en: "My Data Collectors", icon: Users },
          { href: "/system/admin/coaches", zh: "教练管理", en: "Coach Management", icon: UserCog },
          { href: "/system/admin/assistants", zh: "助教管理", en: "Assistant Management", icon: UserCog }
        ] as NavItem[])
      : []),
    ...(user.role === "super_admin"
      ? ([
          { href: "/system/admin/leaders", zh: "团队长管理", en: "Leader Management", icon: UserCog },
          { href: "/system/admin/traders", zh: "数据采集员管理", en: "Data Collector Management", icon: Users },
          { href: "/system/admin/coaches", zh: "教练管理", en: "Coach Management", icon: UserCog },
          { href: "/system/admin/assistants", zh: "助教管理", en: "Assistant Management", icon: UserCog }
        ] as NavItem[])
      : []),
    { href: "/system/admin/students", zh: "学员管理", en: "Students", icon: Users },
    ...(user.role === "leader" || user.role === "super_admin"
      ? ([
          {
            href: "/system/admin/student-documents",
            zh: "学员资料",
            en: "Student Documents",
            icon: FolderDown,
            badge: pending.studentDocuments
          }
        ] as NavItem[])
      : []),
    {
      href: "/system/admin/courses",
      zh: "课程审批",
      en: "Course Approvals",
      icon: ClipboardCheck,
      badge: pending.courseAccess
    },
    {
      href: "/system/admin/course-summaries",
      zh: "课程总结",
      en: "Course Summaries",
      icon: FileText,
      badge: pending.courseSummaries
    },
    {
      href: "/system/admin/weekly-summaries/students",
      zh: "学员周总结",
      en: "Student Weekly Summaries",
      icon: ClipboardList,
      badge: pending.weeklySummariesStudent
    },
    ...(user.role === "leader" || user.role === "super_admin"
      ? ([
          {
            href: "/system/admin/weekly-summaries/assistants",
            zh: "助教周总结",
            en: "Assistant Weekly Summaries",
            icon: ClipboardList,
            badge: pending.weeklySummariesAssistant
          }
        ] as NavItem[])
      : []),
    ...(user.role === "super_admin"
      ? ([
          {
            href: "/system/admin/weekly-summaries/leaders",
            zh: "团队长周总结",
            en: "Leader Weekly Summaries",
            icon: ClipboardList,
            badge: pending.weeklySummariesLeader
          }
        ] as NavItem[])
      : []),
    ...(user.role === "super_admin"
      ? ([{ href: "/system/admin/course-content", zh: "课程内容", en: "Course Content", icon: UploadCloud }] as NavItem[])
      : []),
    ...(user.role === "super_admin"
      ? ([{ href: "/system/admin/files", zh: "文件库", en: "File Library", icon: FolderCog, exact: true }] as NavItem[])
      : []),
    {
      href: "/system/admin/files/requests",
      zh: "文件权限审批",
      en: "File Access",
      icon: ShieldCheck,
      badge: pending.fileAccess
    },
    {
      href: "/system/admin/trade-logs",
      zh: "模拟交易日志审批",
      en: "Simulation Trade Logs",
      icon: FileText,
      badge: pending.tradeLogs
    },
    {
      href: "/system/admin/trade-strategies",
      zh: "模拟交易策略审批",
      en: "Simulation Trade Strategies",
      icon: Lightbulb,
      badge: pending.tradeStrategies
    },
    {
      href: "/system/admin/classic-trades",
      zh: "模拟交易案例管理",
      en: "Simulation Trade Cases",
      icon: ImageUp,
      badge: pending.classicTrades
    },
    { href: "/system/admin/student-strategies", zh: "学员模拟策略管理", en: "Student Simulation Strategies", icon: ClipboardList },
    {
      href: "/system/admin/ladder",
      zh: "天梯管理",
      en: "Ladder Admin",
      icon: ImageUp,
      badge: pending.ladderRequests
    },
    ...(user.role === "super_admin"
      ? ([
          {
            href: "/system/admin/donations",
            zh: "捐赠管理",
            en: "Donations",
            icon: HandHeart,
            badge: pending.donations
          },
          {
            href: "/system/admin/enrollments",
            zh: "报名管理",
            en: "Enrollments",
            icon: ClipboardList,
            badge: pending.enrollments
          },
          {
            href: "/system/admin/contacts",
            zh: "联系管理",
            en: "Contacts",
            icon: Mail,
            badge: pending.contacts
          }
        ] as NavItem[])
      : []),
    ...(user.role === "super_admin"
      ? ([{ href: "/system/admin/reports", zh: "报表", en: "Reports", icon: BarChart3 }] as NavItem[])
      : []),
    { href: "/system/admin/settings", zh: "设置", en: "Settings", icon: Settings, badge: settingsBadge }
    ],
    [pending, settingsBadge, user.role]
  );

  const coachItems: NavItem[] = React.useMemo(
    () => [
    {
      href: "/system/coach/trade-logs",
      zh: "模拟交易日志审批",
      en: "Simulation Trade Logs",
      icon: FileText,
      badge: pending.tradeLogs
    },
    {
      href: "/system/coach/trade-strategies",
      zh: "模拟交易策略审批",
      en: "Simulation Trade Strategies",
      icon: Lightbulb,
      badge: pending.tradeStrategies
    },
    {
      href: "/system/coach/student-strategies",
      zh: "模拟交易策略管理",
      en: "Simulation Strategy Management",
      icon: ClipboardList
    },
    {
      href: "/system/coach/weekly-summaries",
      zh: "学员周总结",
      en: "Weekly Summaries",
      icon: ClipboardList,
      badge: pending.weeklySummariesStudent
    },
    {
      href: "/system/coach/courses",
      zh: "课程审批",
      en: "Course Approvals",
      icon: ClipboardCheck,
      badge: pending.courseAccess
    },
    { href: "/system/coach/reports", zh: "报表", en: "Reports", icon: BarChart3 }
    ],
    [pending]
  );

  const assistantItems: NavItem[] = React.useMemo(
    () => [
    { href: "/system/assistant/students", zh: "学员管理", en: "Students", icon: Users },
    {
      href: "/system/assistant/courses",
      zh: "课程审批",
      en: "Course Approvals",
      icon: ClipboardCheck,
      badge: pending.courseAccess
    },
    {
      href: "/system/assistant/course-summaries",
      zh: "课程总结",
      en: "Course Summaries",
      icon: FileText,
      badge: pending.courseSummaries
    },
    {
      href: "/system/assistant/student-documents",
      zh: "学员资料",
      en: "Student Documents",
      icon: FolderDown,
      badge: pending.studentDocuments
    },
    {
      href: "/system/assistant/files/requests",
      zh: "文件权限审批",
      en: "File Access",
      icon: ShieldCheck,
      badge: pending.fileAccess
    },
    {
      href: "/system/assistant/weekly-summaries",
      zh: "学员周总结",
      en: "Weekly Summaries",
      icon: ClipboardList,
      badge: pending.weeklySummariesStudent
    },
    {
      href: "/system/assistant/trade-logs",
      zh: "模拟交易日志审批",
      en: "Simulation Trade Logs",
      icon: FileText,
      badge: pending.tradeLogs
    },
    {
      href: "/system/assistant/classic-trades",
      zh: "模拟交易案例管理",
      en: "Simulation Trade Cases",
      icon: ImageUp,
      badge: pending.classicTrades
    }
    ],
    [pending]
  );

  if (useMobileLearnerNav) {
    return (
      <aside
        className="system-sidebar system-mobile-sidebar-shell h-0 w-0 min-w-0 max-w-0 shrink-0 border-0 bg-transparent"
        style={{ width: 0, minWidth: 0, maxWidth: 0 }}
        aria-hidden="true"
      />
    );
  }

  return (
    <aside
      className={[
        "system-sidebar h-full flex-shrink-0 border-r border-[color:var(--border)] bg-[color:var(--bg)] flex flex-col transition-[width] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] will-change-[width,transform]",
        sidebarMotion === "collapse" ? "system-sidebar-bounce-collapse" : "",
        sidebarMotion === "expand" ? "system-sidebar-bounce-expand" : ""
      ].join(" ")}
      style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
      data-collapsed={collapsed ? "1" : "0"}
    >
      <div
        className={[
          "sidebar-header flex items-center border-b border-[color:var(--border)] h-[var(--system-topbar-height)]",
          collapsed ? "px-2" : "px-3"
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => toggleCollapsed(false)}
          className={[
            "flex items-center min-w-0",
            collapsed ? "w-full justify-center" : "gap-2"
          ].join(" ")}
          aria-label={
            collapsed
              ? locale === "zh"
                ? "展开侧边栏"
                : "Expand sidebar"
              : locale === "zh"
                ? "系统"
                : "System"
          }
          title={collapsed ? (locale === "zh" ? "点击展开" : "Expand") : undefined}
        >
          <span className="system-sidebar-logo-badge" aria-hidden="true">
            {locale === "zh" ? "系" : "S"}
          </span>
          {!collapsed ? (
            <div className="text-white font-semibold tracking-tight truncate">
              {locale === "zh" ? "系统" : "System"}
            </div>
          ) : null}
        </button>
        {!collapsed ? (
          <button
            type="button"
            onClick={() => toggleCollapsed(true)}
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[color:var(--panel)] text-white/80 hover:bg-[color:var(--panel-2)]"
            aria-label="collapse"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div
        className={[
          "sidebar-body flex flex-col gap-3 overflow-y-auto flex-1 sidebar-scroll",
          collapsed ? "px-2 py-3" : "p-3"
        ].join(" ")}
        ref={scrollRef}
      >
        <div className="sidebar-section flex flex-col gap-2">
          <div className={["sidebar-section-title text-xs text-white/40 px-2", collapsed ? "hidden" : ""].join(" ")}>
            {locale === "zh" ? "学习区" : "Student"}
          </div>
          <div className="sidebar-items flex flex-col gap-2">
            {studentItems.map((item) => (
              <SidebarItem
                key={item.href}
                locale={locale}
                item={item}
                collapsed={collapsed}
                active={isActive(pathname, item)}
                onPrefetch={prefetchRoute}
              />
            ))}
          </div>
        </div>

        {isAdminRole(user.role) ? (
          <div className="sidebar-section flex flex-col gap-2">
            <div
              className={[
                "sidebar-section-title pt-2 text-xs text-white/40 px-2",
                collapsed ? "hidden" : ""
              ].join(" ")}
            >
              {locale === "zh" ? "管理区" : "Admin"}
            </div>
            <div className="sidebar-items flex flex-col gap-2">
              {adminItems.map((item) => (
                <SidebarItem
                  key={item.href}
                  locale={locale}
                  item={item}
                  collapsed={collapsed}
                  active={isActive(pathname, item)}
                  onPrefetch={prefetchRoute}
                />
              ))}
            </div>
          </div>
        ) : null}

        {user.role === "coach" ? (
          <div className="sidebar-section flex flex-col gap-2">
            <div
              className={[
                "sidebar-section-title pt-2 text-xs text-white/40 px-2",
                collapsed ? "hidden" : ""
              ].join(" ")}
            >
              {locale === "zh" ? "教练区" : "Coach"}
            </div>
            <div className="sidebar-items flex flex-col gap-2">
              {coachItems.map((item) => (
                <SidebarItem
                  key={item.href}
                  locale={locale}
                  item={item}
                  collapsed={collapsed}
                  active={isActive(pathname, item)}
                  onPrefetch={prefetchRoute}
                />
              ))}
            </div>
          </div>
        ) : null}

        {user.role === "assistant" ? (
          <div className="sidebar-section flex flex-col gap-2">
            <div
              className={[
                "sidebar-section-title pt-2 text-xs text-white/40 px-2",
                collapsed ? "hidden" : ""
              ].join(" ")}
            >
              {locale === "zh" ? "助教区" : "Assistant"}
            </div>
            <div className="sidebar-items flex flex-col gap-2">
              {assistantItems.map((item) => (
                <SidebarItem
                  key={item.href}
                  locale={locale}
                  item={item}
                  collapsed={collapsed}
                  active={isActive(pathname, item)}
                  onPrefetch={prefetchRoute}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div
        className={[
          "sidebar-footer border-t border-[color:var(--border)]",
          collapsed ? "px-2 py-3" : "p-3"
        ].join(" ")}
      >
        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className={[
            "sidebar-item w-full flex items-center rounded-2xl border text-sm transition-colors",
            collapsed ? "justify-center" : "justify-start gap-3",
            "border-[color:var(--border)] text-white/75 hover:bg-[color:var(--panel)] hover:text-white"
          ].join(" ")}
        >
          <LogOut className="sidebar-icon shrink-0 text-white/70" />
          {!collapsed ? <span>{locale === "zh" ? "退出系统" : "Logout"}</span> : null}
        </button>
      </div>
    </aside>
  );
}
