"use client";

import React from "react";

import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { dispatchPendingDelta, dispatchSystemRealtime } from "@/lib/system/realtime";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PreviewModal } from "@/components/system/PreviewModal";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";

type UserInfo = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  support_name?: string | null;
  assistant_name?: string | null;
  coach_name?: string | null;
};

type SummaryItem = {
  id: string;
  user_id: string;
  course_id: number;
  content_html?: string | null;
  content_md?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  user?: UserInfo | null;
};

export function AdminCourseSummariesClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<SummaryItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<{ name: string; url: string } | null>(null);
  const loadSeqRef = React.useRef(0);
  const recentMutationAtRef = React.useRef(0);

  const load = React.useCallback(async (inputForceFresh = false) => {
    let forceFresh = inputForceFresh;
    if (!forceFresh && Date.now() - recentMutationAtRef.current < 15_000) {
      forceFresh = true;
    }
    const seq = ++loadSeqRef.current;
    if (!items.length) setLoading(true);
    if (forceFresh || !items.length) setError(null);
    try {
      const requestUrl = forceFresh
        ? "/api/system/admin/course-notes/list?fresh=1"
        : "/api/system/admin/course-notes/list";
      const result = await fetchSystemJson<{ ok?: boolean; items?: SummaryItem[] }>(requestUrl, {
        fresh: forceFresh,
        dedupeKey: "admin-course-notes:list",
        dedupeWindowMs: forceFresh ? 0 : 900,
        preferStale: !forceFresh,
        revalidateInBackground: !forceFresh,
        staleTtlMs: 3 * 60_000,
        retries: 2,
        retryBaseMs: 260,
        retryMaxMs: 1500
      });
      if (!result.ok) throw new Error(result.errorCode || "load_failed");
      if (seq !== loadSeqRef.current) return;
      const body = (result.body || {}) as any;
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return;
      setError(e?.message || "load_failed");
    } finally {
      if (seq !== loadSeqRef.current) return;
      setLoading(false);
    }
  }, [items.length]);

  React.useEffect(() => {
    void load(true);
  }, [load]);

  useSystemRealtimeRefresh(() => void load(true), {
    tables: ["course_notes"],
    throttleMs: 2500,
    globalThrottleMs: 3200,
    dedupeKey: "admin-course-notes:list"
  });

  const markReviewed = async (noteId: string, withNote: boolean) => {
    const note = (notes[noteId] || "").trim();
    if (withNote && !note) {
      setError(locale === "zh" ? "请输入审批内容" : "Review note required.");
      return;
    }
    const ok = window.confirm(locale === "zh" ? "确认提交审批？" : "Submit review?");
    if (!ok) return;
    setBusyId(noteId);
    setError(null);
    try {
      const prevItem = items.find((item) => item.id === noteId) || null;
      const shouldDec = Boolean(prevItem?.submitted_at) && !prevItem?.reviewed_at;
      const result = await fetchSystemJson("/api/system/admin/course-notes/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteId, reviewNote: note || undefined }),
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      if (!result.ok) throw new Error(result.errorCode || "update_failed");
      setNotes((prev) => ({ ...prev, [noteId]: "" }));
      setItems((prev) =>
        prev.map((item) =>
          item.id === noteId
            ? {
                ...item,
                reviewed_at: new Date().toISOString(),
                review_note: note || item.review_note
              }
            : item
        )
      );
      recentMutationAtRef.current = Date.now();
      if (shouldDec) dispatchPendingDelta({ courseSummaries: -1 });
      dispatchSystemRealtime({ table: "course_notes", action: "update" });
      void load(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyId(null);
    }
  };

  const markAllReviewed = async () => {
    if (bulkBusy) return;
    const pending = items.filter((it) => !it.reviewed_at && it.submitted_at).length;
    if (!pending) return;
    const ok = window.confirm(locale === "zh" ? "确认一键标记为已阅？" : "Mark all as reviewed?");
    if (!ok) return;
    setBulkBusy(true);
    setError(null);
    try {
      const dec = pending;
      const result = await fetchSystemJson("/api/system/admin/course-notes/review-bulk", {
        method: "POST",
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      if (!result.ok) throw new Error(result.errorCode || "update_failed");
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((item) =>
          !item.reviewed_at && item.submitted_at
            ? {
                ...item,
                reviewed_at: now
              }
            : item
        )
      );
      recentMutationAtRef.current = Date.now();
      if (dec > 0) dispatchPendingDelta({ courseSummaries: -dec });
      dispatchSystemRealtime({ table: "course_notes", action: "update" });
      void load(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const filtered = React.useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => {
      const hay = `${it.user?.full_name || ""} ${it.user?.email || ""} ${it.user?.phone || ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [filter, items]);

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(filtered, {
    deps: [filter]
  });
  const pendingCount = React.useMemo(
    () => items.filter((it) => !it.reviewed_at && it.submitted_at).length,
    [items]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">
          {locale === "zh" ? "课程总结审批" : "Course Summaries"}
        </div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? "查看学员总结并标记已阅或提交审批内容。"
            : "Review course summaries and send feedback."}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 flex flex-wrap items-center gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-[220px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          placeholder={locale === "zh" ? "搜索：姓名/邮箱" : "Search: name/email"}
        />
        <button
          type="button"
          disabled={bulkBusy || pendingCount === 0}
          onClick={markAllReviewed}
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
        >
          {bulkBusy
            ? locale === "zh"
              ? "处理中..."
              : "Processing..."
            : locale === "zh"
              ? `一键已阅${pendingCount ? ` (${pendingCount})` : ""}`
              : `Mark all${pendingCount ? ` (${pendingCount})` : ""}`}
        </button>
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "加载中..." : "Loading..."}
        </div>
      ) : null}

      {!loading && !filtered.length ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "暂无提交" : "No submissions."}
        </div>
      ) : null}

      <div className="space-y-4">
        {pageItems.map((it) => {
          const reviewed = Boolean(it.reviewed_at);
          const status = reviewed ? (locale === "zh" ? "已阅" : "Reviewed") : locale === "zh" ? "待阅" : "Pending";
          const statusClass = reviewed ? "text-emerald-300" : "text-amber-200";
          const baseName = it.user?.full_name || "-";
          const supportLabel = it.user?.support_name ? `（${it.user.support_name}）` : "";
          const name = `${baseName}${supportLabel}`;
          const email = it.user?.email || "-";
          const html = it.content_html || "";
          const text = it.content_md || "";
          const onSummaryDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
            const target = event.target as HTMLElement | null;
            if (!target) return;
            if (target instanceof HTMLImageElement && target.src) {
              setPreview({ name: target.alt || "summary", url: target.src });
            }
          };

          return (
            <div key={it.id} className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-white/90 font-semibold whitespace-nowrap">
                  <span className="system-name">{name}</span>
                </div>
                <div className="text-xs text-white/60">{email}</div>
                <div className="text-xs text-white/50">
                  {locale === "zh" ? `第${it.course_id}课` : `Lesson ${it.course_id}`}
                </div>
                <div className={`text-xs ${statusClass}`}>{status}</div>
                <div className="ml-auto text-xs text-white/50">
                  <ClientDateTime value={it.submitted_at} />
                </div>
              </div>

              <div
                className="rounded-2xl border border-white/10 bg-white/5 p-4 max-h-[260px] overflow-y-auto overflow-x-hidden"
                onDoubleClick={onSummaryDoubleClick}
              >
                {html ? (
                  <div
                    className="summary-preview break-words text-sm text-white/80"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                ) : (
                  <div className="text-sm text-white/80 whitespace-pre-wrap">{text || "-"}</div>
                )}
              </div>

              {it.review_note ? (
                <div className="text-xs text-white/65">
                  {locale === "zh" ? "审批内容" : "Review note"}: {it.review_note}
                </div>
              ) : null}

              <textarea
                value={notes[it.id] || ""}
                onChange={(e) => setNotes((prev) => ({ ...prev, [it.id]: e.target.value }))}
                className="w-full min-h-[90px] rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
                placeholder={locale === "zh" ? "输入审批内容..." : "Write a review note..."}
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === it.id || reviewed}
                  onClick={() => markReviewed(it.id, false)}
                  className={[
                    "rounded-xl border px-3 py-1.5 text-xs disabled:opacity-50",
                    reviewed
                      ? "border-white/10 bg-white/5 text-white/40"
                      : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                  ].join(" ")}
                >
                  {busyId === it.id
                    ? locale === "zh"
                      ? "处理中..."
                      : "Processing..."
                    : locale === "zh"
                      ? "已阅"
                      : "Mark reviewed"}
                </button>
                <button
                  type="button"
                  disabled={busyId === it.id || reviewed}
                  onClick={() => markReviewed(it.id, true)}
                  className={[
                    "rounded-xl border px-3 py-1.5 text-xs disabled:opacity-50",
                    reviewed
                      ? "border-white/10 bg-white/5 text-white/40"
                      : "border-sky-400/30 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                  ].join(" ")}
                >
                  {busyId === it.id
                    ? locale === "zh"
                      ? "处理中..."
                      : "Processing..."
                    : locale === "zh"
                      ? "提交审批"
                      : "Submit review"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {!loading && filtered.length ? (
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
      <PreviewModal
        file={preview ? { name: preview.name, url: preview.url, mimeType: "image" } : null}
        locale={locale}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
