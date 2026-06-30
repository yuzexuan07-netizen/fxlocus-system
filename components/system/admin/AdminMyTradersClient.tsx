"use client";

import React from "react";

import { fetchSystemJson } from "@/lib/system/clientFetch";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";
type TraderRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: "active" | "frozen";
  student_status: string | null;
  created_at?: string;
  last_login_at?: string | null;
};

function formatTime(value: string | null | undefined, locale: "zh" | "en") {
  if (!value) return "-";
  return (
    <ClientDateTime value={value} locale={locale === "zh" ? "zh-CN" : "en-US"} fallback={value} />
  );
}

export function AdminMyTradersClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<TraderRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; items?: TraderRow[] }>("/api/system/admin/students/traders", {
        dedupeKey: "my-traders:list",
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
    dedupeKey: "my-traders:list"
  });

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(items);

  const promote = async (row: TraderRow, action: "leader" | "coach") => {
    const message =
      action === "leader"
        ? locale === "zh"
          ? "确认将该数据采集员升为团队长？"
          : "Promote this data collector to leader?"
        : locale === "zh"
          ? "确认将该数据采集员升为教练？"
          : "Promote this data collector to coach?";
    if (!window.confirm(message)) return;

    try {
      const result = await fetchSystemJson(`/api/system/admin/students/${row.id}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
        retries: 1,
        dedupeWindowMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "update_failed");
      await load();
    } catch (e: any) {
      setError(e?.message || "update_failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "我的数据采集员" : "My data collectors"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? "展示通过考核的学员，可升为团队长或教练。"
            : "Passed students in your team with promotion actions."}
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
          {locale === "zh" ? "数据采集员列表" : "Data collector list"}
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
                <th className="px-6 py-3 text-right">{locale === "zh" ? "操作" : "Actions"}</th>
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
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => promote(row, "leader")}
                      className="px-3 py-1.5 rounded-xl bg-sky-500/10 border border-sky-400/20 text-sky-100 hover:bg-sky-500/15"
                    >
                      {locale === "zh" ? "升为团队长" : "Promote"}
                    </button>
                    <button
                      type="button"
                      onClick={() => promote(row, "coach")}
                      className="ml-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-50"
                    >
                      {locale === "zh" ? "升为教练" : "Coach"}
                    </button>
                  </td>
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
