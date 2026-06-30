"use client";

import React from "react";

import { Link } from "@/i18n/navigation";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";

type DonationStudent = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  student_status: string | null;
  created_at: string | null;
  last_login_at: string | null;
  leader?: { id: string; full_name: string | null; email: string | null } | null;
};

function formatTime(value: string | null | undefined, locale: "zh" | "en") {
  if (!value) return "-";
  return (
    <ClientDateTime
      value={value}
      fallback={value}
      formatter={(date) => {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");
        const hh = String(date.getHours()).padStart(2, "0");
        const min = String(date.getMinutes()).padStart(2, "0");
        return locale === "zh"
          ? `${yyyy}年${mm}月${dd}号  时间：${hh}:${min}`
          : `${yyyy}-${mm}-${dd} ${hh}:${min}`;
      }}
    />
  );
}

export function AdminDonationStudentsClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<DonationStudent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; items?: DonationStudent[] }>(
        "/api/system/admin/donations/students",
        {
          dedupeKey: "admin-donation-students:list",
          retries: 2,
          retryBaseMs: 260,
          retryMaxMs: 1500
        }
      );
      if (!result.ok) throw new Error(result.errorCode || "load_failed");
      const body = (result.body || {}) as any;
      setItems(Array.isArray(body.items) ? body.items : []);
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
    tables: ["profiles", "course_access"],
    throttleMs: 3500,
    globalThrottleMs: 4200,
    dedupeKey: "admin-donation-students:list"
  });

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((row) => {
      const leaderLabel = `${row.leader?.full_name || ""} ${row.leader?.email || ""}`.toLowerCase();
      const hay = `${row.full_name || ""} ${row.email || ""} ${row.phone || ""} ${leaderLabel}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [items, query]);

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(filtered, {
    deps: [query]
  });

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "捐赠学员" : "Donation Students"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh" ? "展示所有捐赠学员，支持搜索与查看详情。" : "All donation students with search and detail links."}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 flex flex-wrap gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          placeholder={locale === "zh" ? "搜索：姓名/邮箱/手机/团队长" : "Search: name/email/phone/leader"}
        />
        <button
          type="button"
          onClick={load}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          {locale === "zh" ? "刷新" : "Refresh"}
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
          {locale === "zh" ? "暂无捐赠学员" : "No donation students."}
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 text-white/85 font-semibold flex items-center gap-2">
          <span>{locale === "zh" ? "列表" : "List"}</span>
          <span className="text-xs text-white/50">{filtered.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-white/50">
              <tr className="border-b border-white/10">
                <th className="px-6 py-3 text-left min-w-[160px] whitespace-nowrap">
                  {locale === "zh" ? "姓名" : "Name"}
                </th>
                <th className="px-6 py-3 text-left">Email</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "手机" : "Phone"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "所属团队长" : "Leader"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "最近登录" : "Last login"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "创建时间" : "Created"}</th>
                <th className="px-6 py-3 text-right">{locale === "zh" ? "操作" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {pageItems.map((row) => {
                const leaderName =
                  row.leader?.full_name || row.leader?.email || (locale === "zh" ? "超管" : "Super admin");
                return (
                  <tr key={row.id} className="hover:bg-white/5">
                    <td className="px-6 py-4 text-white/80 whitespace-nowrap">
                      <span className="system-name">{row.full_name || "-"}</span>
                    </td>
                    <td className="px-6 py-4 text-white/70">{row.email || "-"}</td>
                    <td className="px-6 py-4 text-white/70">{row.phone || "-"}</td>
                    <td className="px-6 py-4 text-white/70">{leaderName}</td>
                    <td className="px-6 py-4 text-white/60">{formatTime(row.last_login_at, locale)}</td>
                    <td className="px-6 py-4 text-white/60">{formatTime(row.created_at, locale)}</td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/system/admin/students/${row.id}`}
                        locale={locale}
                        className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
                      >
                        {locale === "zh" ? "查看详情" : "View"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
