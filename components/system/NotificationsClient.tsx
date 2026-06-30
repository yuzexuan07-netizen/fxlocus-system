"use client";

import React from "react";

import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";
import { dispatchSidebarDelta, dispatchSystemRealtime } from "@/lib/system/realtime";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";
import { repairMojibake } from "@/lib/text/repairMojibake";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";

type NotificationItem = {
  id: string;
  title: string;
  content: string;
  from_user_id: string | null;
  global_notice_id: string | null;
  read_at: string | null;
  pinned_at: string | null;
  created_at: string;
};

type RecipientOption = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
};

type NotificationsClientProps = {
  locale: "zh" | "en";
  initialItems?: NotificationItem[];
  initialUserId?: string | null;
  initialMeRole?: "leader" | "super_admin" | null;
};

export function NotificationsClient({
  locale,
  initialItems = [],
  initialUserId = null,
  initialMeRole = null
}: NotificationsClientProps) {
  const normalizeNotificationItem = React.useCallback(
    (item: NotificationItem): NotificationItem => ({
      ...item,
      title: repairMojibake(item.title),
      content: repairMojibake(item.content)
    }),
    []
  );
  const hasInitialItems = Array.isArray(initialItems) && initialItems.length > 0;
  const [items, setItems] = React.useState<NotificationItem[]>(() => initialItems.map(normalizeNotificationItem));
  const [loading, setLoading] = React.useState(!hasInitialItems);
  const [userId, setUserId] = React.useState<string | null>(initialUserId);
  const [meRole, setMeRole] = React.useState<"leader" | "super_admin" | null>(initialMeRole);
  const [recipients, setRecipients] = React.useState<RecipientOption[]>([]);
  const [recipientQuery, setRecipientQuery] = React.useState("");
  const [globalContent, setGlobalContent] = React.useState("");
  const [globalPinned, setGlobalPinned] = React.useState(false);
  const [targetId, setTargetId] = React.useState("");
  const [targetContent, setTargetContent] = React.useState("");
  const [globalError, setGlobalError] = React.useState("");
  const [globalNotice, setGlobalNotice] = React.useState("");
  const [targetError, setTargetError] = React.useState("");
  const [targetNotice, setTargetNotice] = React.useState("");
  const [sendingGlobal, setSendingGlobal] = React.useState(false);
  const [sendingTarget, setSendingTarget] = React.useState(false);
  const [markingAll, setMarkingAll] = React.useState(false);
  const [pinningId, setPinningId] = React.useState<string | null>(null);
  const [pinError, setPinError] = React.useState("");
  const loadingRef = React.useRef(false);
  const lastLoadAtRef = React.useRef(0);
  const sendingGlobalRef = React.useRef(false);

  const load = React.useCallback(async (withSpinner = false, force = false) => {
    const now = Date.now();
    if (!force && now - lastLoadAtRef.current < 4000) return;
    if (!force && !acquireGlobalPollSlot("notifications:list", 8_000)) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    lastLoadAtRef.current = now;
    if (withSpinner) setLoading(true);
    try {
      const requestUrl = force ? "/api/system/notifications/list?fresh=1" : "/api/system/notifications/list";
      const result = await fetchSystemJson<{ ok?: boolean; items?: NotificationItem[] }>(requestUrl, {
        fresh: force,
        dedupeKey: "notifications:list",
        dedupeWindowMs: force ? 0 : 1000,
        preferStale: !force,
        revalidateInBackground: !force,
        staleTtlMs: 3 * 60_000,
        retries: 2,
        retryBaseMs: 260,
        retryMaxMs: 1400
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) return;
      setItems(Array.isArray(json?.items) ? json.items.map(normalizeNotificationItem) : []);
    } finally {
      loadingRef.current = false;
      if (withSpinner) setLoading(false);
    }
  }, [normalizeNotificationItem]);

  useSystemRealtimeRefresh(
    () => {
      load().catch(() => null);
    },
    { tables: ["notifications"], throttleMs: 3500, globalThrottleMs: 4500, dedupeKey: "notifications:list" }
  );

  React.useEffect(() => {
    let alive = true;
    let lastRefresh = 0;
    const refresh = async () => {
      if (!alive || document.hidden) return;
      const now = Date.now();
      if (now - lastRefresh < 15_000) return;
      lastRefresh = now;
      await load(false, true);
    };

    void load(!hasInitialItems, true);
    const pollMs = typeof navigator !== "undefined" && (navigator as any).connection?.saveData ? 90_000 : 45_000;
    const id = window.setInterval(refresh, pollMs);
    const onFocus = () => {
      if (!document.hidden) refresh();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [hasInitialItems, load]);

  React.useEffect(() => {
    if (initialUserId && initialMeRole) return;
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { id?: string; role?: string } }>("/api/system/me", {
          dedupeKey: "notifications:me",
          retries: 1,
          dedupeWindowMs: 3000
        });
        const json = (result.body || null) as any;
        if (!alive) return;
        if (result.ok && json?.ok) {
          setUserId(String(json.user?.id || ""));
          const role = String(json.user?.role || "");
          if (role === "leader") setMeRole("leader");
          if (role === "super_admin") setMeRole("super_admin");
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialMeRole, initialUserId]);


  const isAdmin = meRole === "leader" || meRole === "super_admin";

  React.useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; items?: RecipientOption[] }>(
          "/api/system/admin/notifications/recipients",
          {
            dedupeKey: "notifications:recipients",
            retries: 2,
            retryBaseMs: 260,
            retryMaxMs: 1400
          }
        );
        const json = (result.body || null) as any;
        if (!alive) return;
        if (!result.ok || !json?.ok) {
          setRecipients([]);
          return;
        }
        setRecipients(Array.isArray(json.items) ? json.items : []);
      } catch {
        if (!alive) return;
        setRecipients([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  const markRead = async (id: string) => {
    const result = await fetchSystemJson<{ ok?: boolean; error?: string; affected?: number }>(`/api/system/notifications/${id}/read`, {
      method: "POST",
      dedupeKey: `notifications:read:${id}`,
      retries: 1,
      retryBaseMs: 260,
      retryMaxMs: 1200,
      dedupeWindowMs: 200
    });
    const json = (result.body || null) as any;
    if (!result.ok || !json?.ok) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, read_at: now } : item)));
    const affected = Math.max(0, Number(json?.affected || 0));
    if (affected > 0) dispatchSidebarDelta({ unread: -affected, holdMs: 1_200 }, "notifications_read");
    load(false, true);
    dispatchSystemRealtime({ table: "notifications", action: "update" });
  };

  const markAllRead = async () => {
    if (markingAll) return;
    const ok = window.confirm(locale === "zh" ? "确认全部标记为已读？" : "Mark all as read?");
    if (!ok) return;
    setMarkingAll(true);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; error?: string; affected?: number }>("/api/system/notifications/read-all", {
        method: "POST",
        dedupeKey: "notifications:read-all",
        retries: 1,
        retryBaseMs: 260,
        retryMaxMs: 1200,
        dedupeWindowMs: 300
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) return;
      const unreadCount = Math.max(0, Number(json?.affected || items.filter((item) => !item.read_at).length || 0));
      const now = new Date().toISOString();
      setItems((prev) => prev.map((item) => ({ ...item, read_at: item.read_at || now })));
      if (unreadCount > 0) {
        dispatchSidebarDelta({ unread: -unreadCount, holdMs: 1_200 }, "notifications_read_all");
      }
      await load(false, true);
      dispatchSystemRealtime({ table: "notifications", action: "update" });
    } finally {
      setMarkingAll(false);
    }
  };

  const cancelGlobalPin = async (id: string) => {
    if (!isAdmin || pinningId === id) return;
    setPinError("");
    setPinningId(id);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; error?: string }>(`/api/system/notifications/${id}/pin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: false }),
        dedupeKey: `notifications:pin:${id}:0`,
        retries: 1,
        retryBaseMs: 260,
        retryMaxMs: 1200,
        dedupeWindowMs: 200
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) {
        throw new Error(json?.error || result.errorCode || "pin_failed");
      }
      await load(false, true);
      dispatchSystemRealtime({ table: "notifications", action: "update" });
    } catch (e: any) {
      setPinError(String(e?.message || (locale === "zh" ? "置顶操作失败" : "Pin action failed")));
    } finally {
      setPinningId(null);
    }
  };

  const roleLabel = React.useCallback(
    (role: string | null) => {
      const key = String(role || "");
      if (locale === "zh") {
        if (key === "student") return "学员";
        if (key === "trader") return "数据采集员";
        if (key === "coach") return "教练";
        if (key === "leader") return "团队长";
        return "其他";
      }
      if (key === "student") return "Student";
      if (key === "trader") return "Data Collector";
      if (key === "coach") return "Coach";
      if (key === "leader") return "Leader";
      return "Other";
    },
    [locale]
  );

  const filteredRecipients = React.useMemo(() => {
    const q = recipientQuery.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter((r) => {
      const name = String(r.full_name || "");
      const email = String(r.email || "");
      const role = roleLabel(r.role);
      const hay = `${name} ${email} ${role} ${r.id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [recipients, recipientQuery, roleLabel]);

  const sendGlobal = async () => {
    const content = globalContent.trim();
    if (!content || sendingGlobalRef.current) return;
    const ok = window.confirm(locale === "zh" ? "确认发送全局通知？" : "Send global notice?");
    if (!ok) return;
    const requestId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `global_notice_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    setGlobalError("");
    setGlobalNotice("");
    sendingGlobalRef.current = true;
    setSendingGlobal(true);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; error?: string }>(
        "/api/system/admin/notifications/send-global",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: locale === "zh" ? "全局通知" : "Global notice",
            content,
            pinned: globalPinned,
            requestId
          }),
          dedupeKey: `notifications:send-global:${requestId}`,
          retries: 1,
          retryBaseMs: 260,
          retryMaxMs: 1400
        }
      );
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "send_failed");
      setGlobalContent("");
      setGlobalPinned(false);
      setGlobalNotice(locale === "zh" ? "已发送全局通知" : "Global notice sent");
    } catch (e: any) {
      setGlobalError(e?.message || "send_failed");
    } finally {
      sendingGlobalRef.current = false;
      setSendingGlobal(false);
    }
  };

  const sendTarget = async () => {
    const content = targetContent.trim();
    if (!targetId || !content) return;
    const ok = window.confirm(locale === "zh" ? "确认发送单独通知？" : "Send this notice?");
    if (!ok) return;
    setTargetError("");
    setTargetNotice("");
    setSendingTarget(true);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; error?: string }>("/api/system/admin/notifications/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userIds: [targetId],
          title: locale === "zh" ? "单独通知" : "Direct notice",
          content
        }),
        dedupeKey: `notifications:send:${targetId}:${content}`,
        retries: 1,
        retryBaseMs: 260,
        retryMaxMs: 1400
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "send_failed");
      setTargetContent("");
      setTargetId("");
      setTargetNotice(locale === "zh" ? "已发送单独通知" : "Notice sent");
    } catch (e: any) {
      setTargetError(e?.message || "send_failed");
    } finally {
      setSendingTarget(false);
    }
  };

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(items);

  return (
    <div className={`space-y-6 ${isAdmin ? "max-w-[1200px]" : "max-w-[900px]"}`}>
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "通知" : "Notifications"}</div>
          <button
            type="button"
            disabled={markingAll || !items.some((n) => !n.read_at)}
            onClick={markAllRead}
            className="ml-auto rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            {markingAll
              ? locale === "zh"
                ? "处理中..."
                : "Processing..."
              : locale === "zh"
                ? "一键已读"
                : "Mark all read"}
          </button>
        </div>
      </div>

      <div className={isAdmin ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]" : ""}>
        <div className="space-y-6">
          {loading ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
              {locale === "zh" ? "加载中..." : "Loading..."}
            </div>
          ) : null}

          {!loading && !items.length ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
              {locale === "zh" ? "暂无消息。" : "No messages."}
            </div>
          ) : null}

          {pinError ? (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200/90">
              {pinError}
            </div>
          ) : null}

          <div className="space-y-3">
            {pageItems.map((n) => (
              <div
                key={n.id}
                className={`rounded-3xl border p-6 ${
                  n.pinned_at ? "border-amber-300/35 bg-amber-500/5" : "border-white/10 bg-white/5"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="text-white/90 font-semibold">{n.title}</div>
                  {n.pinned_at ? (
                    <span className="rounded-full border border-amber-300/40 bg-amber-300/15 px-2 py-0.5 text-[11px] text-amber-100">
                      {locale === "zh" ? "置顶" : "Pinned"}
                    </span>
                  ) : null}
                  <div className="ml-auto text-xs text-white/50">
                    <ClientDateTime value={n.created_at} />
                  </div>
                </div>
                <div className="mt-2 text-white/70 leading-7 whitespace-pre-wrap">{n.content}</div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {n.read_at ? (
                    <span className="text-xs text-white/50">{locale === "zh" ? "已读" : "Read"}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => markRead(n.id)}
                      className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15"
                    >
                      {locale === "zh" ? "标记已读" : "Mark as read"}
                    </button>
                  )}
                  {isAdmin ? (
                    n.pinned_at && n.global_notice_id && n.from_user_id === userId ? (
                      <button
                        type="button"
                        disabled={pinningId === n.id}
                        onClick={() => cancelGlobalPin(n.id)}
                        className="px-3 py-1.5 rounded-xl border border-amber-300/35 bg-amber-300/10 text-amber-100 hover:bg-amber-300/20 disabled:opacity-50"
                      >
                        {pinningId === n.id
                          ? locale === "zh"
                            ? "处理中..."
                            : "Processing..."
                          : locale === "zh"
                            ? "取消置顶"
                            : "Unpin"}
                      </button>
                    ) : null
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {!loading && items.length ? (
            <div className="rounded-3xl border border-white/10 bg-white/5">
              <PaginationControls
                total={total}
                page={page}
                pageSize={pageSize}
                pageCount={pageCount}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                locale={locale}
              />
            </div>
          ) : null}
        </div>

        {isAdmin ? (
          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-3">
              <div className="text-white/90 font-semibold">{locale === "zh" ? "全局通知" : "Global notice"}</div>
              <div className="text-xs text-white/55">
                {locale === "zh"
                  ? "发送给当前权限范围内的学员、数据采集员、教练、助教、团队长（含子团队长）。"
                  : "Send to all students, data collectors, coaches, assistants, and leaders in your scope (including child leaders)."}
              </div>
              <textarea
                value={globalContent}
                onChange={(e) => setGlobalContent(e.target.value)}
                className="min-h-[120px] w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
                placeholder={locale === "zh" ? "输入通知内容..." : "Write a notice..."}
              />
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={globalPinned}
                  onChange={(e) => setGlobalPinned(e.target.checked)}
                  className="h-4 w-4 rounded border-white/30 bg-transparent"
                />
                <span>{locale === "zh" ? "发布后置顶（默认不勾选）" : "Pin after sending (default off)"}</span>
              </label>
              <button
                type="button"
                disabled={sendingGlobal || !globalContent.trim()}
                onClick={sendGlobal}
                className="w-full px-3 py-2 rounded-xl bg-sky-500/15 border border-sky-400/30 text-sky-100 hover:bg-sky-500/20 disabled:opacity-50"
              >
                {sendingGlobal ? (locale === "zh" ? "发送中..." : "Sending...") : locale === "zh" ? "通知全部" : "Notify all"}
              </button>
              {globalNotice ? <div className="text-xs text-emerald-200/80">{globalNotice}</div> : null}
              {globalError ? <div className="text-xs text-rose-200/80">{globalError}</div> : null}
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-3">
              <div className="text-white/90 font-semibold">{locale === "zh" ? "独立通知" : "Direct notice"}</div>
              <input
                value={recipientQuery}
                onChange={(e) => setRecipientQuery(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
                placeholder={locale === "zh" ? "搜索学员/数据采集员/教练/助教/团队长" : "Search recipient"}
              />
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
              >
                <option value="">{locale === "zh" ? "选择接收对象" : "Select recipient"}</option>
                {filteredRecipients.map((r) => {
                  const label = r.full_name || r.email || r.id.slice(0, 6);
                  return (
                    <option key={r.id} value={r.id}>
                      {label} · {roleLabel(r.role)}
                    </option>
                  );
                })}
              </select>
              <div className="text-xs text-white/50">
                {locale === "zh" ? `共 ${filteredRecipients.length} 人` : `${filteredRecipients.length} recipients`}
              </div>
              <textarea
                value={targetContent}
                onChange={(e) => setTargetContent(e.target.value)}
                className="min-h-[120px] w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
                placeholder={locale === "zh" ? "输入通知内容..." : "Write a notice..."}
              />
              <button
                type="button"
                disabled={sendingTarget || !targetId || !targetContent.trim()}
                onClick={sendTarget}
                className="w-full px-3 py-2 rounded-xl bg-emerald-400/15 border border-emerald-400/30 text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
              >
                {sendingTarget ? (locale === "zh" ? "发送中..." : "Sending...") : locale === "zh" ? "发送通知" : "Send"}
              </button>
              {targetNotice ? <div className="text-xs text-emerald-200/80">{targetNotice}</div> : null}
              {targetError ? <div className="text-xs text-rose-200/80">{targetError}</div> : null}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
