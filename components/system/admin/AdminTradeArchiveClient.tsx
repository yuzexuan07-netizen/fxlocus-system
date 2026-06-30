"use client";

import React from "react";
import { Download, FileText } from "lucide-react";

import { useDebounce } from "@/lib/hooks/useDebounce";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { dispatchSystemRealtime } from "@/lib/system/realtime";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PreviewModal } from "@/components/system/PreviewModal";
import { saveWithPicker } from "@/lib/downloads/saveWithPicker";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";

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
  type: "trade_log" | "trade_strategy";
  review_note?: string | null;
  created_at: string;
  archived_at: string | null;
  user?: { full_name?: string | null; email?: string | null; phone?: string | null } | null;
  files: SubmissionFile[];
};

const TYPE_OPTIONS = [
  { value: "all", zh: "全部", en: "All" },
  { value: "trade_strategy", zh: "模拟交易策略", en: "Simulation Trade Strategy" },
  { value: "trade_log", zh: "模拟交易日志", en: "Simulation Trade Log" }
] as const;

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

function typeLabel(locale: "zh" | "en", value: SubmissionItem["type"]) {
  if (value === "trade_strategy") return locale === "zh" ? "模拟交易策略" : "Simulation trade strategy";
  return locale === "zh" ? "模拟交易日志" : "Simulation trade log";
}

type AdminTradeArchiveClientProps = {
  locale: "zh" | "en";
  lockType?: "trade_strategy" | "trade_log";
  canDelete?: boolean;
  hideTypeFilter?: boolean;
  title?: { zh: string; en: string };
  description?: { zh: string; en: string };
};

export function AdminTradeArchiveClient({
  locale,
  lockType,
  canDelete = true,
  hideTypeFilter = false,
  title,
  description
}: AdminTradeArchiveClientProps) {
  const [items, setItems] = React.useState<SubmissionItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<(typeof TYPE_OPTIONS)[number]["value"]>(
    lockType || "trade_strategy"
  );
  const [preview, setPreview] = React.useState<SubmissionFile | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const debounced = useDebounce(filter.trim(), 350);
  const effectiveTypeFilter = lockType || typeFilter;

  React.useEffect(() => {
    if (!lockType) return;
    setTypeFilter(lockType);
  }, [lockType]);

  const load = React.useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("type", effectiveTypeFilter);
      if (debounced) params.set("q", debounced);
      const requestUrl = `/api/system/admin/trade-submissions/archived?${params.toString()}`;
      const result = await fetchSystemJson<{ ok?: boolean; items?: SubmissionItem[] }>(requestUrl, {
        dedupeKey: `trade-archive:list:${effectiveTypeFilter}:${debounced}`,
        retries: 2,
        retryBaseMs: 280,
        retryMaxMs: 1600
      });
      if (!result.ok) throw new Error(result.errorCode || "load_failed");
      const body = (result.body || {}) as any;
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e: any) {
      setError(e?.message || "load_failed");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [debounced, effectiveTypeFilter]);

  React.useEffect(() => {
    void load();
  }, [load]);

  useSystemRealtimeRefresh(
    () => {
      void load({ silent: true });
    },
    {
      throttleMs: 3000,
      globalThrottleMs: 3600,
      dedupeKey: `trade-archive:${effectiveTypeFilter}`,
      tables: ["trade_submissions"]
    }
  );

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(items, {
    deps: [effectiveTypeFilter, debounced]
  });

  const removeItem = React.useCallback(
    async (id: string) => {
      if (!canDelete) return;
      const ok = window.confirm(locale === "zh" ? "确认删除该归档记录？" : "Delete archived record?");
      if (!ok) return;
      setDeletingId(id);
      setError(null);
      let previousItems: SubmissionItem[] = [];
      setItems((prev) => {
        previousItems = prev;
        return prev.filter((item) => item.id !== id);
      });
      try {
        const result = await fetchSystemJson<{ ok?: boolean; error?: string }>(
          "/api/system/admin/trade-submissions/delete",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ submissionId: id }),
            dedupeKey: `trade-archive:delete:${id}`,
            retries: 1,
            retryBaseMs: 280,
            retryMaxMs: 1200
          }
        );
        const json = (result.body || null) as any;
        if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "delete_failed");
        dispatchSystemRealtime({ table: "trade_submissions", action: "delete" });
      } catch (e: any) {
        setItems(previousItems);
        setError(e?.message || "delete_failed");
      } finally {
        setDeletingId(null);
      }
    },
    [canDelete, locale]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">
          {locale === "zh" ? title?.zh || "学员策略管理" : title?.en || "Student strategy archive"}
        </div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? description?.zh || "查看已存档的模拟交易日志与模拟交易策略，支持按学员搜索。"
            : description?.en || "Browse archived simulation trade logs and strategies with search."}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 flex flex-wrap gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          placeholder={locale === "zh" ? "搜索学员：姓名/邮箱/手机" : "Search: name/email/phone"}
        />
        {!hideTypeFilter && !lockType ? (
          <select
            value={effectiveTypeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {locale === "zh" ? opt.zh : opt.en}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "加载中..." : "Loading..."}
        </div>
      ) : null}

      {!loading && !items.length ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "暂无归档" : "No archived items."}
        </div>
      ) : null}

      <div className="space-y-4">
        {pageItems.map((it) => {
          const name = it.user?.full_name || "-";
          const email = it.user?.email || "-";
          return (
            <div key={it.id} className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-white/90 font-semibold whitespace-nowrap">
                  <span className="system-name">{name}</span>
                </div>
                <div className="text-xs text-white/60">{email}</div>
                <div className="text-xs text-white/50">{typeLabel(locale, it.type)}</div>
                <div className="ml-auto flex items-center gap-2 text-xs text-white/50">
                  <ClientDateTime value={it.archived_at} />
                  {canDelete ? (
                    <button
                      type="button"
                      disabled={deletingId === it.id}
                      onClick={() => removeItem(it.id)}
                      className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-100 hover:bg-rose-500/20 disabled:opacity-60"
                    >
                      {locale === "zh" ? "删除" : "Delete"}
                    </button>
                  ) : null}
                </div>
              </div>

              {it.review_note ? (
                <div className="text-xs text-white/65">
                  {locale === "zh" ? "审批意见" : "Review note"}: {it.review_note}
                </div>
              ) : null}

              <div className="space-y-2">
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
                      {locale === "zh" ? "预览" : "Preview"}
                    </button>
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
                      {locale === "zh" ? "下载" : "Download"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
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

      <PreviewModal
        file={
          preview
            ? { name: preview.file_name, url: preview.url, mimeType: preview.mime_type }
            : null
        }
        locale={locale}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
