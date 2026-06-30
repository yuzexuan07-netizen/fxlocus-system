"use client";

import React from "react";

import { fetchSystemJson } from "@/lib/system/clientFetch";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";
type LeaderRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  status: "active" | "frozen";
  created_at?: string;
  last_login_at?: string | null;
};

function formatTime(value: string | null | undefined, locale: "zh" | "en") {
  if (!value) return "-";
  return (
    <ClientDateTime value={value} locale={locale === "zh" ? "zh-CN" : "en-US"} fallback={value} />
  );
}

export function AdminMyLeadersClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<LeaderRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; items?: LeaderRow[] }>("/api/system/admin/leaders/my", {
        dedupeKey: "my-leaders:list",
        retries: 2,
        retryBaseMs: 260,
        retryMaxMs: 1500
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "load_failed");
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setError(e?.message || "load_failed");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);
  useSystemRealtimeRefresh(load, {
    tables: ["profiles"],
    throttleMs: 3000,
    globalThrottleMs: 3600,
    dedupeKey: "my-leaders:list"
  });

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(items);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "我的团队长" : "My leaders"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh" ? "展示你名下的所有团队长。" : "Leaders under your team."}
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "加载中…" : "Loading…"}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 text-white/85 font-semibold">
          {locale === "zh" ? "团队长列表" : "Leader list"}
        </div>

        {!loading && !items.length ? (
          <div className="p-6 text-white/60">{locale === "zh" ? "暂无数据" : "No items"}</div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-white/50">
              <tr className="border-b border-white/10">
                <th className="px-6 py-3 text-left min-w-[160px] whitespace-nowrap">
                  {locale === "zh" ? "姓名" : "Name"}
                </th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "邮箱" : "Email"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "手机" : "Phone"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "状态" : "Status"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "最近登录" : "Last login"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "创建时间" : "Created"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {pageItems.map((row) => (
                <tr key={row.id} className="hover:bg-white/5">
                  <td className="px-6 py-4 text-white/85 font-semibold whitespace-nowrap">
                    <span className="system-name">{row.full_name || "-"}</span>
                  </td>
                  <td className="px-6 py-4 text-white/70">{row.email || "-"}</td>
                  <td className="px-6 py-4 text-white/70">{row.phone || "-"}</td>
                  <td className="px-6 py-4 text-white/70">
                    <span className={row.status === "active" ? "text-emerald-300" : "text-rose-300"}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-white/60">{formatTime(row.last_login_at, locale)}</td>
                  <td className="px-6 py-4 text-white/60">{formatTime(row.created_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && items.length ? (
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
