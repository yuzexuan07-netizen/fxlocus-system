"use client";

import React from "react";

import { dispatchPendingDelta, dispatchSystemRealtime } from "@/lib/system/realtime";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";
import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";

type RequestItem = {
  user_id: string;
  course_id: number;
  requested_at?: string | null;
  user?: {
    id: string;
    full_name?: string;
    email?: string | null;
    phone?: string | null;
    support_name?: string | null;
    assistant_name?: string | null;
    coach_name?: string | null;
  } | null;
  course?: { id: number; title_en?: string; title_zh?: string } | null;
};

const REJECTION_REASONS = ["资料不完整", "不符合要求", "名额已满", "重复申请", "其他"] as const;
type RejectionReason = (typeof REJECTION_REASONS)[number];

export function AdminCourseAccessClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<RequestItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [filterCourseId, setFilterCourseId] = React.useState("");
  const [filterStudent, setFilterStudent] = React.useState("");

  const [rejectReason, setRejectReason] = React.useState<Record<string, string>>({});
  const [bulkRejectReason, setBulkRejectReason] = React.useState<RejectionReason>("其他");
  const retryTimerRef = React.useRef<number | null>(null);
  const loadSeqRef = React.useRef(0);
  const recentMutationAtRef = React.useRef(0);

  const keyOf = React.useCallback((it: Pick<RequestItem, "user_id" | "course_id">) => `${it.user_id}:${it.course_id}`, []);

  const filtered = React.useMemo(() => {
    const courseId = filterCourseId.trim() ? Number(filterCourseId) : null;
    const needle = filterStudent.trim().toLowerCase();
    return items.filter((it) => {
      if (courseId && Number(it.course_id) !== courseId) return false;
      if (!needle) return true;
      const hay = `${it.user?.full_name || ""} ${it.user?.email || ""} ${it.user?.phone || ""} ${it.user?.support_name || ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [filterCourseId, filterStudent, items]);

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(filtered, {
    deps: [filterCourseId, filterStudent]
  });

  const selectedItems = React.useMemo(() => {
    const byKey = new Map(items.map((it) => [keyOf(it), it]));
    return Array.from(selected)
      .map((k) => byKey.get(k))
      .filter(Boolean) as RequestItem[];
  }, [items, keyOf, selected]);

  const allFilteredSelected = React.useMemo(() => {
    if (!filtered.length) return false;
    return filtered.every((it) => selected.has(keyOf(it)));
  }, [filtered, keyOf, selected]);

  const load = React.useCallback(async (inputForce = false) => {
    let force = inputForce;
    if (!force && Date.now() - recentMutationAtRef.current < 15_000) {
      force = true;
    }
    const seq = ++loadSeqRef.current;
    if (!force) {
      const granted = acquireGlobalPollSlot("admin-course-access:list", 12_000);
      if (!granted) return;
    }
    if (!items.length) setLoading(true);
    if (force || !items.length) setError(null);
    try {
      const requestUrl = force ? "/api/system/admin/courses/requests?fresh=1" : "/api/system/admin/courses/requests";
      const result = await fetchSystemJson<{ ok?: boolean; items?: RequestItem[] }>(
        requestUrl,
        {
          fresh: force,
          dedupeKey: "admin-course-access:list",
          dedupeWindowMs: force ? 250 : 1800,
          preferStale: !force,
          revalidateInBackground: !force,
          staleTtlMs: 5 * 60_000,
          allowStaleOnRateLimit: true,
          retries: 2,
          retryBaseMs: 260,
          retryMaxMs: 1500
        }
      );
      if (!result.ok) {
        const code = String(result.errorCode || "").toUpperCase();
        if (
          result.status === 429 ||
          result.status === 503 ||
          code === "RATE_LIMITED" ||
          code === "TOO_MANY_REQUESTS" ||
          code === "DB_BUSY"
        ) {
          if (!items.length) setError(locale === "zh" ? "加载中，请稍后..." : "Loading, please wait...");
          if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            void load(true);
          }, 1100);
          return;
        }
        throw new Error(result.errorCode || "load_failed");
      }

      const body = (result.body || {}) as any;
      const nextItems = Array.isArray(body.items) ? (body.items as RequestItem[]) : [];
      if (seq !== loadSeqRef.current) return;
      setItems(nextItems);
      setError(null);
      setSelected((prev) => {
        const keep = new Set(nextItems.map((it) => keyOf(it)));
        const next = new Set<string>();
        for (const k of prev) if (keep.has(k)) next.add(k);
        return next;
      });
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return;
      setError(e?.message || "load_failed");
    } finally {
      if (seq !== loadSeqRef.current) return;
      setLoading(false);
    }
  }, [items.length, keyOf, locale]);

  React.useEffect(() => {
    void load(true);
    return () => {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [load]);

  useSystemRealtimeRefresh(() => void load(true), {
    tables: ["course_access"],
    throttleMs: 4500,
    globalThrottleMs: 6000,
    dedupeKey: "admin-course-access:list"
  });


  const reviewBulk = async (payload: { items: Array<{ userId: string; courseId: number }>; action: "approve" | "reject"; reason?: string }) => {
    const result = await fetchSystemJson("/api/system/admin/courses/review-bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      retries: 1,
      retryBaseMs: 220,
      retryMaxMs: 1200
    });
    if (!result.ok) throw new Error(result.errorCode || "update_failed");
  };

  const approveAll = async () => {
    if (!items.length) return;
    setBusyKey("ALL");
    setError(null);
    try {
      const dec = items.length;
      await reviewBulk({
        items: items.map((it) => ({ userId: it.user_id, courseId: it.course_id })),
        action: "approve"
      });
      setItems([]);
      recentMutationAtRef.current = Date.now();
      dispatchPendingDelta({ courseAccess: -dec });
      dispatchSystemRealtime({ table: "course_access", action: "update" });
      void load(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyKey(null);
    }
  };

  const reviewOne = async (it: RequestItem, action: "approve" | "reject") => {
    const k = keyOf(it);
    setBusyKey(k);
    setError(null);
    try {
      await reviewBulk({
        items: [{ userId: it.user_id, courseId: it.course_id }],
        action,
        reason: action === "reject" ? rejectReason[k] || undefined : undefined
      });
      setItems((prev) => prev.filter((row) => keyOf(row) !== k));
      recentMutationAtRef.current = Date.now();
      dispatchPendingDelta({ courseAccess: -1 });
      dispatchSystemRealtime({ table: "course_access", action: "update" });
      void load(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyKey(null);
    }
  };

  const reviewSelected = async (action: "approve" | "reject") => {
    if (!selectedItems.length) return;
    setBusyKey("BULK");
    setError(null);
    try {
      const dec = selectedItems.length;
      await reviewBulk({
        items: selectedItems.map((it) => ({ userId: it.user_id, courseId: it.course_id })),
        action,
        reason: action === "reject" ? bulkRejectReason : undefined
      });
      setSelected(new Set());
      setBulkRejectReason("其他");
      setItems((prev) => {
        const removing = new Set(selectedItems.map((row) => keyOf(row)));
        return prev.filter((row) => !removing.has(keyOf(row)));
      });
      recentMutationAtRef.current = Date.now();
      dispatchPendingDelta({ courseAccess: -dec });
      dispatchSystemRealtime({ table: "course_access", action: "update" });
      void load(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyKey(null);
    }
  };

  const toggleSelected = (it: RequestItem) => {
    const k = keyOf(it);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const it of filtered) next.delete(keyOf(it));
      } else {
        for (const it of filtered) next.add(keyOf(it));
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 flex items-center gap-3">
        <div>
          <div className="text-white/90 font-semibold text-xl">
            {locale === "zh" ? "课程权限审批" : "Course access"}
          </div>
          <div className="mt-2 text-white/60 text-sm">
            {locale === "zh"
              ? "处理学员课程申请：支持筛选、多选批量通过/拒绝。"
              : "Review student requests with filters and bulk approve/reject."}
          </div>
        </div>
        <button
          type="button"
          disabled={busyKey === "ALL"}
          onClick={approveAll}
          className="ml-auto px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50"
        >
          {busyKey === "ALL"
            ? locale === "zh"
              ? "处理中..."
              : "Processing..."
            : locale === "zh"
              ? "一键通过全部"
              : "Approve all"}
        </button>
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 text-white/85 font-semibold">
          {locale === "zh" ? "待审批列表" : "Pending list"}
        </div>

        <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center gap-2">
          <input
            value={filterCourseId}
            onChange={(e) => setFilterCourseId(e.target.value)}
            className="w-[140px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
            placeholder={locale === "zh" ? "课程ID" : "Course ID"}
          />
          <input
            value={filterStudent}
            onChange={(e) => setFilterStudent(e.target.value)}
            className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
            placeholder={locale === "zh" ? "搜索学员：姓名/邮箱/手机" : "Search student: name/email/phone"}
          />
          <button
            type="button"
            disabled={!selectedItems.length || busyKey === "BULK"}
            onClick={() => reviewSelected("approve")}
            className="px-3 py-2 rounded-xl bg-emerald-400/15 border border-emerald-400/30 text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
          >
            {busyKey === "BULK"
              ? locale === "zh"
                ? "处理中..."
                : "Processing..."
              : locale === "zh"
                ? `通过已选(${selectedItems.length})`
                : `Approve (${selectedItems.length})`}
          </button>
          <button
            type="button"
            disabled={!selectedItems.length || busyKey === "BULK"}
            onClick={() => reviewSelected("reject")}
            className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-400/20 text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
          >
            {busyKey === "BULK"
              ? locale === "zh"
                ? "处理中..."
                : "Processing..."
              : locale === "zh"
                ? `拒绝已选(${selectedItems.length})`
                : `Reject (${selectedItems.length})`}
          </button>
          <select
            value={bulkRejectReason}
            onChange={(e) => setBulkRejectReason(e.target.value as RejectionReason)}
            className="min-w-[220px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          >
            {REJECTION_REASONS.map((r) => (
              <option key={r} value={r}>
                {locale === "zh" ? `拒绝原因：${r}` : `Reason: ${r}`}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-6 text-white/60">{locale === "zh" ? "加载中..." : "Loading..."}</div>
        ) : null}

        {!loading && !filtered.length ? (
          <div className="p-6 text-white/60">{locale === "zh" ? "暂无申请" : "No requests"}</div>
        ) : null}

        <div className="divide-y divide-white/10">
          {pageItems.map((it) => {
            const k = keyOf(it);
            const title = locale === "zh" ? it.course?.title_zh : it.course?.title_en;
            const contact = [it.user?.email, it.user?.phone].filter(Boolean).join(" · ");
            const nameBase = it.user?.full_name || it.user?.email || "-";
            const supportLabel = it.user?.support_name ? `（${it.user.support_name}）` : "";
            const displayName = `${nameBase}${supportLabel}`;
            return (
              <div key={k} className="px-6 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(k)}
                    onChange={() => toggleSelected(it)}
                    className="h-4 w-4 accent-sky-400"
                    aria-label="select"
                  />
                  <div className="text-white/90 font-semibold">
                    #{it.course_id} {title || ""}
                  </div>
                  <div className="text-xs text-white/50">
                    <span className="system-name">{displayName}</span>
                    {contact ? ` · ${contact}` : ""}
                  </div>
                  <div className="ml-auto text-xs text-white/50">
                    <ClientDateTime value={it.requested_at} />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busyKey === k}
                    onClick={() => reviewOne(it, "approve")}
                    className="px-3 py-1.5 rounded-xl bg-emerald-400/15 border border-emerald-400/30 text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
                  >
                    {busyKey === k
                      ? locale === "zh"
                        ? "处理中..."
                        : "Processing..."
                      : locale === "zh"
                        ? "通过"
                        : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === k}
                    onClick={() => reviewOne(it, "reject")}
                    className="px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-400/20 text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
                  >
                    {busyKey === k
                      ? locale === "zh"
                        ? "处理中..."
                        : "Processing..."
                      : locale === "zh"
                        ? "拒绝"
                        : "Reject"}
                  </button>
                  <select
                    value={(rejectReason[k] || "其他") as RejectionReason}
                    onChange={(e) => setRejectReason((p) => ({ ...p, [k]: e.target.value }))}
                    className="ml-auto min-w-[240px] rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/85"
                  >
                    {REJECTION_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {locale === "zh" ? `拒绝原因：${r}` : `Reason: ${r}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex items-center gap-2 text-xs text-white/50">
          <button
            type="button"
            onClick={toggleSelectAllFiltered}
            className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"
          >
            {allFilteredSelected
              ? locale === "zh"
                ? "取消全选"
                : "Clear all"
              : locale === "zh"
                ? "全选当前"
                : "Select all"}
          </button>
          <span className="ml-auto">
            {locale === "zh" ? "当前显示" : "Showing"} {pageItems.length} · {" "}
            {locale === "zh" ? "已选" : "Selected"} {selectedItems.length}
          </span>
        </div>
        {!loading && filtered.length ? (
          <PaginationControls
            total={total}
            page={page}
            pageSize={pageSize}
            pageCount={pageCount}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            locale={locale}
          />
        ) : null}
      </div>
    </div>
  );
}
