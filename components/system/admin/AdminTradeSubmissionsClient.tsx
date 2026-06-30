"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { Download, FileText } from "lucide-react";

import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { dispatchPendingDelta, dispatchSystemRealtime } from "@/lib/system/realtime";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PreviewModal } from "@/components/system/PreviewModal";
import { saveWithPicker } from "@/lib/downloads/saveWithPicker";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { useProgressiveList } from "@/lib/hooks/useProgressiveList";
import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";

type SubmissionFile = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  url: string | null;
};

type SubmissionItem = {
  id: string;
  user_id: string;
  leader_id: string | null;
  status: "submitted" | "approved" | "rejected";
  rejection_reason?: string | null;
  review_note?: string | null;
  created_at: string;
  user?: { full_name?: string | null; email?: string | null; phone?: string | null } | null;
  support_name?: string | null;
  assistant_name?: string | null;
  coach_name?: string | null;
  files: SubmissionFile[];
};

type Config = {
  titleZh: string;
  titleEn: string;
};

const CONFIG: Record<"trade_log" | "trade_strategy", Config> = {
  trade_log: {
    titleZh: "模拟交易日志审批",
    titleEn: "Simulation trade log reviews"
  },
  trade_strategy: {
    titleZh: "模拟交易策略审批",
    titleEn: "Simulation trade strategy reviews"
  }
};

function bytesToHuman(bytes: number) {
  if (!bytes || bytes < 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function statusLabel(locale: "zh" | "en", status: SubmissionItem["status"]) {
  const zh = {
    submitted: "\u5df2\u63d0\u4ea4",
    approved: "\u5df2\u9605",
    rejected: "\u5df2\u62d2\u7edd"
  };
  const en = { submitted: "Submitted", approved: "Reviewed", rejected: "Rejected" };
  return (locale === "zh" ? zh : en)[status] || status;
}

function statusClass(status: SubmissionItem["status"]) {
  if (status === "approved") return "text-emerald-300";
  if (status === "rejected") return "text-rose-300";
  return "text-amber-200";
}

function resolveSupportDisplayName(item: {
  support_name?: string | null;
  assistant_name?: string | null;
  coach_name?: string | null;
}) {
  return String(item.coach_name || item.assistant_name || item.support_name || "").trim();
}

function missingFilesMessage(locale: "zh" | "en") {
  return locale === "zh"
    ? "该提交的附件文件已被清理，当前无法预览原文件；如已核对其它信息，可继续批阅或归档。"
    : "The original files for this submission were cleaned up, so preview is unavailable. You can still review or archive it.";
}

export function AdminTradeSubmissionsClient({
  locale,
  type
}: {
  locale: "zh" | "en";
  type: "trade_log" | "trade_strategy";
}) {
  const cfg = CONFIG[type];
  const pendingKey = type === "trade_log" ? "tradeLogs" : "tradeStrategies";
  const searchParams = useSearchParams();
  const coachId = searchParams?.get("coachId") || "";
  const [items, setItems] = React.useState<SubmissionItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [total, setTotal] = React.useState(0);
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<SubmissionFile | null>(null);
  const [pendingTotal, setPendingTotal] = React.useState(0);
  const retryTimerRef = React.useRef<number | null>(null);
  const loadSeqRef = React.useRef(0);
  const recentMutationAtRef = React.useRef(0);

  React.useEffect(() => {
    setPage(1);
  }, [coachId, type]);

  const listUrl = React.useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("type", type);
    if (coachId) qs.set("coachId", coachId);
    qs.set("page", String(page));
    qs.set("pageSize", String(pageSize));
    return `/api/system/admin/trade-submissions/list?${qs.toString()}`;
  }, [coachId, page, pageSize, type]);

  const cacheKey = React.useMemo(
    () => `admin-trade-submissions:${type}:${coachId || "__all__"}:${page}:${pageSize}`,
    [coachId, page, pageSize, type]
  );

  const load = React.useCallback(
    async (options?: { forceFresh?: boolean }) => {
      let forceFresh = Boolean(options?.forceFresh);
      if (!forceFresh && Date.now() - recentMutationAtRef.current < 15_000) {
        forceFresh = true;
      }
      const seq = ++loadSeqRef.current;
      const isMobileApp =
        typeof document !== "undefined" && document.documentElement.getAttribute("data-mobile-app") === "1";
      if (!forceFresh) {
        const granted = acquireGlobalPollSlot(cacheKey, isMobileApp ? 2500 : 12_000);
        if (!granted) return;
      }
      if (!items.length) setLoading(true);
      if (forceFresh || !items.length) setError(null);
      try {
        const requestUrl = forceFresh ? `${listUrl}&fresh=1` : listUrl;
        const result = await fetchSystemJson<{
          ok?: boolean;
          items?: SubmissionItem[];
          total?: number;
          pendingTotal?: number;
        }>(requestUrl, {
          fresh: forceFresh,
          dedupeKey: cacheKey,
          dedupeWindowMs: forceFresh || isMobileApp ? 0 : 1400,
          preferStale: !forceFresh,
          revalidateInBackground: !forceFresh,
          staleTtlMs: 5 * 60_000,
          allowStaleOnRateLimit: true,
          retries: 2,
          retryBaseMs: 260,
          retryMaxMs: 1500
        });
        if (!result.ok) {
          const code = String(result.errorCode || "").toUpperCase();
          const transient =
            result.status === 429 ||
            result.status === 503 ||
            result.status === 0 ||
            result.rateLimited ||
            code === "RATE_LIMITED" ||
            code === "TOO_MANY_REQUESTS" ||
            code === "DB_BUSY";
          if (transient) {
            if (!items.length) {
              setError(locale === "zh" ? "\u52a0\u8f7d\u4e2d\uff0c\u8bf7\u7a0d\u540e..." : "Loading, please wait...");
            }
            if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              void load({ forceFresh: true });
            }, 1200);
            return;
          }
          if (!items.length) {
            setError(locale === "zh" ? "\u670d\u52a1\u7e41\u5fd9\uff0c\u6b63\u5728\u81ea\u52a8\u91cd\u8bd5..." : "Service busy, retrying...");
            if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
            retryTimerRef.current = window.setTimeout(() => {
              retryTimerRef.current = null;
              void load({ forceFresh: true });
            }, 1600);
            return;
          }
          throw new Error(result.errorCode || "load_failed");
        }
        if (seq !== loadSeqRef.current) return;
        const body = (result.body || {}) as any;
        setItems(Array.isArray(body.items) ? body.items : []);
        setTotal(Math.max(0, Number(body.total || 0)));
        if (typeof body.pendingTotal === "number" && Number.isFinite(body.pendingTotal)) {
          setPendingTotal(Math.max(0, Math.floor(body.pendingTotal)));
        } else {
          const fallbackPending = Array.isArray(body.items)
            ? body.items.filter((it: SubmissionItem) => it.status === "submitted").length
            : 0;
          setPendingTotal(fallbackPending);
        }
        setError(null);
      } catch (e: any) {
        if (seq !== loadSeqRef.current) return;
        setError(e?.message || "load_failed");
      } finally {
        if (seq !== loadSeqRef.current) return;
        setLoading(false);
      }
    },
    [cacheKey, items.length, listUrl, locale]
  );

  React.useEffect(() => {
    void load({ forceFresh: true });
    return () => {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [load]);

  useSystemRealtimeRefresh(
    () => {
      void load({ forceFresh: true });
    },
    {
      tables: ["trade_submissions"],
      throttleMs: 4500,
      globalThrottleMs: 6200,
      dedupeKey: cacheKey
    }
  );

  const markReviewed = async (submissionId: string) => {
    const note = (notes[submissionId] || "").trim();
    const ok = window.confirm(
      locale === "zh" ? "\u786e\u8ba4\u6807\u8bb0\u4e3a\u5df2\u9605\uff1f" : "Mark as reviewed?"
    );
    if (!ok) return;
    setBusyId(submissionId);
    setError(null);
    try {
      const prevItem = items.find((item) => item.id === submissionId) || null;
      const shouldDec = prevItem?.status === "submitted";
      const result = await fetchSystemJson("/api/system/admin/trade-submissions/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId, note: note || undefined }),
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      const errorCode = String(result.errorCode || "").toUpperCase();
      const alreadyReviewed = !result.ok && errorCode === "ALREADY_REVIEWED";
      if (!result.ok && !alreadyReviewed) throw new Error(result.errorCode || "update_failed");
      setNotes((prev) => ({ ...prev, [submissionId]: "" }));
      setItems((prev) =>
        prev.map((item) =>
          item.id === submissionId
            ? {
                ...item,
                status: "approved",
                review_note: note || item.review_note
              }
            : item
        )
      );
      if (shouldDec) {
        setPendingTotal((prev) => Math.max(0, prev - 1));
      }
      recentMutationAtRef.current = Date.now();
      if (shouldDec) dispatchPendingDelta({ [pendingKey]: -1 });
      dispatchSystemRealtime({ table: "trade_submissions", action: "update" });
      if (alreadyReviewed) setError(null);
      void load({ forceFresh: true });
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyId(null);
    }
  };

  const markAllReviewed = async () => {
    if (bulkBusy) return;
    const pending = pendingTotal;
    if (!pending) return;
    const ok = window.confirm(
      locale === "zh" ? "\u786e\u8ba4\u4e00\u952e\u6807\u8bb0\u4e3a\u5df2\u9605\uff1f" : "Mark all as reviewed?"
    );
    if (!ok) return;
    setBulkBusy(true);
    setError(null);
    try {
      const result = await fetchSystemJson("/api/system/admin/trade-submissions/review-bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          coachId: coachId || undefined
        }),
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      if (!result.ok) throw new Error(result.errorCode || "update_failed");
      const reviewedCount = Math.max(
        0,
        Number.isFinite(Number((result.body as any)?.count)) ? Number((result.body as any)?.count) : pending
      );
      setItems((prev) =>
        prev.map((item) =>
          item.status === "submitted"
            ? {
                ...item,
                status: "approved"
              }
            : item
        )
      );
      if (reviewedCount > 0) {
        setPendingTotal((prev) => Math.max(0, prev - reviewedCount));
      }
      recentMutationAtRef.current = Date.now();
      if (reviewedCount > 0) dispatchPendingDelta({ [pendingKey]: -reviewedCount });
      dispatchSystemRealtime({ table: "trade_submissions", action: "update" });
      void load({ forceFresh: true });
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const archive = async (submissionId: string) => {
    const ok = window.confirm(locale === "zh" ? "\u786e\u8ba4\u5f52\u6863\u8be5\u7b56\u7565\uff1f" : "Archive this strategy?");
    if (!ok) return;
    setBusyId(submissionId);
    setError(null);
    try {
      const prevItem = items.find((item) => item.id === submissionId) || null;
      const shouldDec = prevItem?.status === "submitted";
      const result = await fetchSystemJson("/api/system/admin/trade-submissions/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId }),
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      const errorCode = String(result.errorCode || "").toUpperCase();
      const alreadyArchived = !result.ok && errorCode === "ALREADY_ARCHIVED";
      if (!result.ok && !alreadyArchived) throw new Error(result.errorCode || "archive_failed");
      setItems((prev) => prev.filter((item) => item.id !== submissionId));
      if (shouldDec) {
        setPendingTotal((prev) => Math.max(0, prev - 1));
      }
      recentMutationAtRef.current = Date.now();
      if (shouldDec) dispatchPendingDelta({ [pendingKey]: -1 });
      dispatchSystemRealtime({ table: "trade_submissions", action: "update" });
      if (alreadyArchived) {
        setError(null);
      }
      void load({ forceFresh: true });
    } catch (e: any) {
      setError(e?.message || "archive_failed");
    } finally {
      setBusyId(null);
    }
  };

  const filtered = React.useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => {
      const supportLabel = resolveSupportDisplayName(it);
      const hay = `${it.user?.full_name || ""} ${it.user?.email || ""} ${it.user?.phone || ""} ${
        supportLabel
      }`.toLowerCase();
      return hay.includes(needle);
    });
  }, [filter, items]);

  const ordered = React.useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      if (a.status === b.status) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (a.status === "submitted") return -1;
      if (b.status === "submitted") return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return list;
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(Math.max(total, 0) / Math.max(pageSize, 1)));
  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const {
    visibleItems: visiblePageItems,
    hasMore: hasMorePageItems,
    sentinelRef: pageItemsSentinelRef
  } = useProgressiveList(ordered, {
    initial: 6,
    step: 6,
    enabled: ordered.length > 8,
    deps: [page, pageSize, filter, coachId, type]
  });
  const pendingCount = pendingTotal;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? cfg.titleZh : cfg.titleEn}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh" ? "\u67e5\u770b\u5b66\u5458\u63d0\u4ea4\u5e76\u6807\u8bb0\u5df2\u9605\u3002" : "Review submissions and mark as reviewed."}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 flex flex-wrap items-center gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-[220px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          placeholder={locale === "zh" ? "\u641c\u7d22\u5b66\u5458\uff1a\u59d3\u540d/\u90ae\u7bb1/\u624b\u673a" : "Search: name/email/phone"}
        />
        <button
          type="button"
          disabled={bulkBusy || pendingCount === 0}
          onClick={markAllReviewed}
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
        >
          {bulkBusy
            ? locale === "zh"
              ? "\u5904\u7406\u4e2d..."
              : "Processing..."
            : locale === "zh"
              ? `\u4e00\u952e\u5df2\u9605${pendingCount ? ` (${pendingCount})` : ""}`
              : `Mark all${pendingCount ? ` (${pendingCount})` : ""}`}
        </button>
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "\u52a0\u8f7d\u4e2d..." : "Loading..."}
        </div>
      ) : null}

      {!loading && !filtered.length ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "\u6682\u65e0\u63d0\u4ea4" : "No submissions."}
        </div>
      ) : null}

      <div className="space-y-4">
        {visiblePageItems.map((it) => {
          const name = it.user?.full_name || "-";
          const supportName = resolveSupportDisplayName(it);
          const supportLabel = supportName ? `\uff08${supportName}\uff09` : "";
          const email = it.user?.email || "-";
          const missingFiles = it.files.length === 0;
          const reviewLocked = it.status !== "submitted";
          return (
            <div key={it.id} className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-white/90 font-semibold whitespace-nowrap">
                  <span className="system-name">
                    {name}
                    {supportLabel ? <span className="ml-1 text-xs text-white/55">{supportLabel}</span> : null}
                  </span>
                </div>
                <div className="text-xs text-white/60">{email}</div>
                <div className={`text-xs ${statusClass(it.status)}`}>{statusLabel(locale, it.status)}</div>
                <div className="ml-auto text-xs text-white/50">
                  <ClientDateTime value={it.created_at} />
                </div>
              </div>

              {it.review_note ? (
                <div className="text-xs text-white/65">
                  {locale === "zh" ? "\u5ba1\u6279\u610f\u89c1" : "Review note"}: {it.review_note}
                </div>
              ) : null}

              <div className="space-y-2">
                {missingFiles ? (
                  <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100/90">
                    {missingFilesMessage(locale)}
                  </div>
                ) : null}
                {it.files.map((file) => (
                  <div key={file.id} className="flex flex-wrap items-center gap-2 text-sm text-white/75">
                    <FileText className="h-4 w-4 text-white/60" />
                    <span className="max-w-[360px] truncate">{file.file_name}</span>
                    <span className="text-xs text-white/45">{bytesToHuman(file.size_bytes)}</span>
                    <button
                      type="button"
                      disabled={!file.url}
                      onClick={() => file.url && setPreview(file)}
                      className="ml-auto rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                    >
                      {locale === "zh" ? "\u9884\u89c8" : "Preview"}
                    </button>
                    {type === "trade_strategy" ? (
                      <button
                        type="button"
                        disabled={!file.url}
                        onClick={() => {
                          if (!file.url) return;
                          void saveWithPicker({
                            url: `/api/system/trade-submission-files/${file.id}/download`,
                            filename: file.file_name || "strategy",
                            mimeType: file.mime_type || undefined
                          });
                        }}
                        className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                      >
                        <Download className="mr-1 inline h-3 w-3" />
                        {locale === "zh" ? "\u4e0b\u8f7d" : "Download"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <textarea
                  value={notes[it.id] || ""}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [it.id]: e.target.value }))}
                  disabled={reviewLocked}
                  className="min-h-[72px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 disabled:opacity-60"
                  placeholder={locale === "zh" ? "\u5ba1\u6279\u610f\u89c1\uff08\u53ef\u9009\uff09" : "Review note (optional)"}
                />
                <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch">
                  <button
                    type="button"
                    disabled={busyId === it.id || reviewLocked}
                    onClick={() => markReviewed(it.id)}
                    className={[
                      "px-3 py-2 rounded-xl border disabled:opacity-50",
                      reviewLocked
                        ? "border-white/10 bg-white/5 text-white/40"
                        : "bg-emerald-400/15 border-emerald-400/30 text-emerald-100 hover:bg-emerald-400/20"
                    ].join(" ")}
                  >
                    {busyId === it.id
                      ? locale === "zh"
                        ? "\u5904\u7406\u4e2d..."
                        : "Processing..."
                      : locale === "zh"
                        ? "\u5df2\u9605"
                        : "Reviewed"}
                  </button>
                  {type === "trade_strategy" ? (
                    <button
                      type="button"
                      disabled={busyId === it.id}
                      onClick={() => archive(it.id)}
                      className="px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50"
                    >
                      {busyId === it.id ? (locale === "zh" ? "\u5f52\u6863\u4e2d..." : "Archiving...") : locale === "zh" ? "\u5f52\u6863" : "Archive"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
        {hasMorePageItems ? (
          <div ref={pageItemsSentinelRef} className="py-2 text-center text-xs text-white/45">
            {locale === "zh" ? "\u4e0b\u62c9\u7ee7\u7eed\u52a0\u8f7d..." : "Scroll to load more..."}
          </div>
        ) : null}
      </div>

      {!loading && total > 0 ? (
        <div className="rounded-3xl border border-white/10 bg-white/5">
          <PaginationControls
            total={total}
            page={page}
            pageSize={pageSize}
            pageCount={pageCount}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
            locale={locale}
          />
        </div>
      ) : null}

      <PreviewModal
        file={preview ? { name: preview.file_name, url: preview.url, mimeType: preview.mime_type } : null}
        locale={locale}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
