"use client";

import React from "react";

import { Link } from "@/i18n/navigation";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";

type CoachRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  leader_id: string | null;
  leader?: { id?: string | null; full_name?: string | null; email?: string | null } | null;
  status: "active" | "frozen";
  created_at?: string;
  last_login_at?: string | null;
  assigned_count?: number | null;
  managed_leader_ids?: string[] | null;
};

type LeaderRow = { id: string; full_name: string | null; email: string | null };
type AssignedUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  student_status?: string | null;
  status?: string | null;
};

function formatTime(value: string | null | undefined, locale: "zh" | "en") {
  if (!value) return "-";
  return (
    <ClientDateTime value={value} locale={locale === "zh" ? "zh-CN" : "en-US"} fallback={value} />
  );
}

export function AdminCoachesClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<CoachRow[]>([]);
  const [leaders, setLeaders] = React.useState<LeaderRow[]>([]);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [assignedByCoach, setAssignedByCoach] = React.useState<Record<string, AssignedUser[]>>({});
  const [assignedBusy, setAssignedBusy] = React.useState<Record<string, boolean>>({});
  const [assignedError, setAssignedError] = React.useState<Record<string, string>>({});
  const [meRole, setMeRole] = React.useState<"leader" | "super_admin" | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { role?: string | null } }>("/api/system/me", {
          dedupeKey: "coaches:me",
          dedupeWindowMs: 1200,
          retries: 1
        });
        const json = (result.body || null) as any;
        if (!alive) return;
        const role = json?.ok ? String(json?.user?.role || "") : "";
        if (role === "super_admin") setMeRole("super_admin");
        else if (role === "leader") setMeRole("leader");
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (meRole !== "super_admin") return;
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; items?: LeaderRow[] }>("/api/system/admin/leaders/list", {
          dedupeKey: "coaches:leaders",
          dedupeWindowMs: 1500,
          retries: 1
        });
        const json = (result.body || null) as any;
        if (!alive) return;
        if (!result.ok || !json?.ok) return;
        const raw: LeaderRow[] = Array.isArray(json.items) ? json.items : [];
        setLeaders(raw.filter((r: any) => r.role === "leader" || r.role === "super_admin"));
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [meRole]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; items?: CoachRow[] }>("/api/system/admin/coaches/list", {
        dedupeKey: "coaches:list",
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
    tables: ["profiles", "coach_assignments"],
    throttleMs: 3000,
    globalThrottleMs: 3600,
    dedupeKey: "coaches:list"
  });

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(items);

  const leaderById = React.useMemo(
    () => new Map(leaders.map((l) => [l.id, l])),
    [leaders]
  );

  const toggleAssigned = async (coachId: string, count: number) => {
    if (!count) return;
    if (expanded === coachId) {
      setExpanded(null);
      return;
    }
    setExpanded(coachId);
    if (assignedByCoach[coachId]) return;
    setAssignedBusy((prev) => ({ ...prev, [coachId]: true }));
    setAssignedError((prev) => ({ ...prev, [coachId]: "" }));
    try {
      const result = await fetchSystemJson<{ ok?: boolean; items?: AssignedUser[] }>(
        `/api/system/admin/coaches/assigned?coachId=${coachId}`,
        {
          dedupeKey: `coaches:assigned:${coachId}`,
          dedupeWindowMs: 1000,
          retries: 1
        }
      );
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "load_failed");
      setAssignedByCoach((prev) => ({ ...prev, [coachId]: Array.isArray(json.items) ? json.items : [] }));
    } catch (e: any) {
      setAssignedError((prev) => ({ ...prev, [coachId]: e?.message || "load_failed" }));
    } finally {
      setAssignedBusy((prev) => ({ ...prev, [coachId]: false }));
    }
  };

  const colSpan = meRole === "super_admin" ? 9 : 8;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "教练管理" : "Coaches"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? "查看教练账号、分配情况与账号状态。"
            : "Manage coach accounts, assignments, and status."}
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
          {locale === "zh" ? "教练列表" : "Coach list"}
        </div>

        {!loading && !items.length ? (
          <div className="p-6 text-white/60">{locale === "zh" ? "暂无数据" : "No items"}</div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-white/50">
              <tr className="border-b border-white/10">
                <th className="px-6 py-3 text-left !min-w-[220px] !max-w-none !whitespace-nowrap !overflow-visible !text-clip">
                  {locale === "zh" ? "姓名" : "Name"}
                </th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "邮箱" : "Email"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "手机" : "Phone"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "所属团队长" : "Leader"}</th>
                {meRole === "super_admin" ? (
                  <th className="px-6 py-3 text-left">{locale === "zh" ? "管理团队长" : "Managed leaders"}</th>
                ) : null}
                <th className="px-6 py-3 text-left">{locale === "zh" ? "已分配学员" : "Assigned"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "状态" : "Status"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "最近登录" : "Last login"}</th>
                <th className="px-6 py-3 text-right">{locale === "zh" ? "操作" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {pageItems.map((row) => {
                const leader = row.leader_id ? leaderById.get(row.leader_id) : null;
                const leaderName =
                  row.leader?.full_name || row.leader?.email || leader?.full_name || leader?.email || "-";
                const status = row.status === "frozen" ? "frozen" : "active";
                const managedLeaders =
                  meRole === "super_admin" && Array.isArray(row.managed_leader_ids) && row.managed_leader_ids.length
                    ? row.managed_leader_ids
                        .map((id) => {
                          const info = leaderById.get(id);
                          return info?.full_name || info?.email || id.slice(0, 6);
                        })
                        .join(", ")
                    : "-";
                const assignedCount = row.assigned_count ?? 0;
                const isOpen = expanded === row.id;
                const assignedItems = assignedByCoach[row.id] || [];
                const busy = assignedBusy[row.id];
                const err = assignedError[row.id];
                return (
                  <React.Fragment key={row.id}>
                    <tr className="hover:bg-white/5">
                      <td className="px-6 py-4 text-white/85 font-semibold !min-w-[220px] !max-w-none !whitespace-nowrap !overflow-visible !text-clip">
                        <span className="system-name">{row.full_name || "-"}</span>
                      </td>
                    <td className="px-6 py-4 text-white/70 max-w-[240px] truncate">{row.email || "-"}</td>
                    <td className="px-6 py-4 text-white/70">{row.phone || "-"}</td>
                    <td className="px-6 py-4 text-white/70">{leaderName}</td>
                    {meRole === "super_admin" ? (
                      <td className="px-6 py-4 text-white/70">{managedLeaders}</td>
                    ) : null}
                    <td className="px-6 py-4 text-white/70">
                      <button
                        type="button"
                        disabled={!assignedCount}
                        onClick={() => toggleAssigned(row.id, assignedCount)}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                      >
                        {locale === "zh" ? "查看" : "View"} ({assignedCount})
                      </button>
                    </td>
                    <td className="px-6 py-4 text-white/70">
                      <span className={status === "active" ? "text-emerald-300" : "text-rose-300"}>{status}</span>
                    </td>
                    <td className="px-6 py-4 text-white/60">{formatTime(row.last_login_at, locale)}</td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/system/admin/students/${row.id}`}
                        locale={locale}
                        className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
                      >
                        {locale === "zh" ? "详情" : "Details"}
                      </Link>
                    </td>
                    </tr>
                    {isOpen ? (
                      <tr className="bg-white/3">
                        <td colSpan={colSpan} className="px-6 py-4">
                          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="text-sm text-white/80 font-semibold">
                              {locale === "zh" ? "已分配学员" : "Assigned learners"}
                            </div>
                            {busy ? (
                              <div className="mt-3 text-sm text-white/60">
                                {locale === "zh" ? "加载中…" : "Loading…"}
                              </div>
                            ) : err ? (
                              <div className="mt-3 text-sm text-rose-200">{err}</div>
                            ) : !assignedItems.length ? (
                              <div className="mt-3 text-sm text-white/60">
                                {locale === "zh" ? "暂无数据" : "No items"}
                              </div>
                            ) : (
                              <div className="mt-3 overflow-x-auto">
                                <table className="min-w-full text-xs">
                                  <thead className="text-white/50">
                                    <tr className="border-b border-white/10">
                                      <th className="px-3 py-2 text-left !whitespace-nowrap">
                                        {locale === "zh" ? "姓名" : "Name"}
                                      </th>
                                      <th className="px-3 py-2 text-left">{locale === "zh" ? "邮箱" : "Email"}</th>
                                      <th className="px-3 py-2 text-left">{locale === "zh" ? "手机" : "Phone"}</th>
                                      <th className="px-3 py-2 text-left">{locale === "zh" ? "角色" : "Role"}</th>
                                      <th className="px-3 py-2 text-left">{locale === "zh" ? "状态" : "Status"}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/10 text-white/80">
                                    {assignedItems.map((item) => (
                                      <tr key={item.id} className="hover:bg-white/5">
                                        <td className="px-3 py-2 !whitespace-nowrap">
                                          <span className="system-name">{item.full_name || "-"}</span>
                                        </td>
                                        <td className="px-3 py-2">{item.email || "-"}</td>
                                        <td className="px-3 py-2">{item.phone || "-"}</td>
                                        <td className="px-3 py-2">{item.role || "-"}</td>
                                        <td className="px-3 py-2">{item.status || "-"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
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
