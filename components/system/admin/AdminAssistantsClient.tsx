"use client";

import React from "react";

import { ClientDateTime } from "@/components/system/ClientDateTime";
import { Tooltip } from "@/components/system/Tooltip";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { isStrongSystemPassword } from "@/lib/system/passwordPolicy";
import { dispatchSystemRealtime } from "@/lib/system/realtime";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";

type AssistantRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  leader_id: string | null;
  leader?: { id?: string | null; full_name?: string | null; email?: string | null } | null;
  status: "active" | "frozen";
  created_at?: string;
  last_login_at?: string | null;
};

type AssistantStudentRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: "student" | "trader" | "coach";
  status: "active" | "frozen";
  student_status?: string | null;
  last_login_at?: string | null;
};

type LeaderRow = { id: string; full_name: string | null; email: string | null };

const PHONE_REGEX = /^\+?[0-9]{6,20}$/;

function formatTime(value: string | null | undefined, locale: "zh" | "en") {
  if (!value) return "-";
  return (
    <ClientDateTime value={value} locale={locale === "zh" ? "zh-CN" : "en-US"} fallback={value} />
  );
}

export function AdminAssistantsClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<AssistantRow[]>([]);
  const [leaders, setLeaders] = React.useState<LeaderRow[]>([]);
  const [meRole, setMeRole] = React.useState<"leader" | "super_admin" | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [children, setChildren] = React.useState<Record<string, AssistantStudentRow[]>>({});
  const [childrenLoading, setChildrenLoading] = React.useState<Record<string, boolean>>({});
  const [childrenError, setChildrenError] = React.useState<Record<string, string | null>>({});
  const [rowPendingAction, setRowPendingAction] = React.useState<Record<string, "status" | "delete" | "promote">>({});

  const [form, setForm] = React.useState({
    fullName: "",
    email: "",
    phone: "",
    password: ""
  });

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { role?: string | null } }>("/api/system/me", {
          dedupeKey: "assistants:me",
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
          dedupeKey: "assistants:leaders",
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

  const load = React.useCallback(async (options?: { forceFresh?: boolean; silent?: boolean }) => {
    const forceFresh = Boolean(options?.forceFresh);
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    if (!silent || forceFresh) setError(null);
    try {
      const result = await fetchSystemJson<{ ok?: boolean; items?: AssistantRow[] }>(
        forceFresh ? "/api/system/admin/assistants/list?fresh=1" : "/api/system/admin/assistants/list",
        {
          fresh: forceFresh,
          dedupeKey: `assistants:list:fresh:${forceFresh ? 1 : 0}`,
          dedupeWindowMs: forceFresh ? 0 : 500,
          preferStale: false,
          revalidateInBackground: false,
          staleTtlMs: 0,
          retries: 2,
          retryBaseMs: 260,
          retryMaxMs: 1500
        }
      );
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "load_failed");
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e: any) {
      setError(e?.message || "load_failed");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load({ forceFresh: true });
  }, [load]);
  useSystemRealtimeRefresh(() => {
    void load({ forceFresh: true, silent: true });
  }, {
    tables: ["profiles"],
    throttleMs: 3000,
    globalThrottleMs: 3600,
    dedupeKey: "assistants:list"
  });

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(items);

  const loadChildren = React.useCallback(async (assistantId: string) => {
    setChildrenLoading((prev) => ({ ...prev, [assistantId]: true }));
    setChildrenError((prev) => ({ ...prev, [assistantId]: null }));
    try {
      const result = await fetchSystemJson<{ ok?: boolean; items?: AssistantStudentRow[] }>(
        `/api/system/admin/assistants/${assistantId}/students`,
        {
          dedupeKey: `assistants:students:${assistantId}`,
          dedupeWindowMs: 800,
          retries: 1
        }
      );
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "load_failed");
      setChildren((prev) => ({
        ...prev,
        [assistantId]: Array.isArray(json.items) ? json.items : []
      }));
    } catch (e: any) {
      setChildrenError((prev) => ({ ...prev, [assistantId]: e?.message || "load_failed" }));
    } finally {
      setChildrenLoading((prev) => ({ ...prev, [assistantId]: false }));
    }
  }, []);

  const toggleExpanded = React.useCallback(
    (assistantId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(assistantId)) {
          next.delete(assistantId);
        } else {
          next.add(assistantId);
          if (!children[assistantId]) {
            loadChildren(assistantId);
          }
        }
        return next;
      });
    },
    [children, loadChildren]
  );

  const leaderById = React.useMemo(() => new Map(leaders.map((l) => [l.id, l])), [leaders]);
  const setRowPending = React.useCallback((assistantId: string, action: "status" | "delete" | "promote") => {
    setRowPendingAction((prev) => ({ ...prev, [assistantId]: action }));
  }, []);
  const clearRowPending = React.useCallback((assistantId: string) => {
    setRowPendingAction((prev) => {
      if (!prev[assistantId]) return prev;
      const next = { ...prev };
      delete next[assistantId];
      return next;
    });
  }, []);

  const createAssistant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (meRole !== "leader" && meRole !== "super_admin") return;
    try {
      if (!isStrongSystemPassword(form.password)) {
        throw new Error(locale === "zh" ? "密码强度不足" : "Weak password");
      }
      const phone = form.phone.trim().replace(/[\s-]/g, "");
      if (!phone || !PHONE_REGEX.test(phone)) {
        throw new Error(locale === "zh" ? "手机号格式不正确" : "Invalid phone number");
      }
      setCreating(true);
      const result = await fetchSystemJson("/api/system/admin/assistants/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          phone,
          password: form.password
        }),
        retries: 1,
        dedupeWindowMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "create_failed");
      setForm({ fullName: "", email: "", phone: "", password: "" });
      dispatchSystemRealtime({ table: "profiles", action: "insert" });
      dispatchSystemRealtime({ table: "sidebar_counts", action: "update" });
      await load({ forceFresh: true });
    } catch (e: any) {
      setError(e?.message || "create_failed");
    } finally {
      setCreating(false);
    }
  };

  const toggleStatus = async (row: AssistantRow) => {
    if (rowPendingAction[row.id]) return;
    const next = row.status === "active" ? "frozen" : "active";
    const ok = window.confirm(
      locale === "zh"
        ? next === "frozen"
          ? "确认冻结该助教账号？"
          : "确认解冻该助教账号？"
        : next === "frozen"
          ? "Freeze this assistant?"
          : "Unfreeze this assistant?"
    );
    if (!ok) return;
    setError(null);
    setRowPending(row.id, "status");
    try {
      const result = await fetchSystemJson("/api/system/admin/assistants/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: row.id, status: next }),
        retries: 1,
        dedupeWindowMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "update_failed");
      dispatchSystemRealtime({ table: "profiles", action: "update" });
      dispatchSystemRealtime({ table: "sidebar_counts", action: "update" });
      await load({ forceFresh: true });
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      clearRowPending(row.id);
    }
  };

  const deleteAssistant = async (row: AssistantRow) => {
    if (rowPendingAction[row.id]) return;
    const ok = window.confirm(
      locale === "zh" ? "确认删除该助教账号？" : "Delete this assistant account?"
    );
    if (!ok) return;
    setError(null);
    setRowPending(row.id, "delete");
    try {
      const result = await fetchSystemJson("/api/system/admin/assistants/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: row.id }),
        retries: 1,
        dedupeWindowMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "delete_failed");
      dispatchSystemRealtime({ table: "profiles", action: "delete" });
      dispatchSystemRealtime({ table: "sidebar_counts", action: "update" });
      await load({ forceFresh: true });
    } catch (e: any) {
      setError(e?.message || "delete_failed");
    } finally {
      clearRowPending(row.id);
    }
  };

  const promoteToLeader = async (row: AssistantRow) => {
    if (rowPendingAction[row.id]) return;
    const ok = window.confirm(
      locale === "zh" ? "确认将该助教升为团队长？" : "Promote this assistant to leader?"
    );
    if (!ok) return;
    setError(null);
    setRowPending(row.id, "promote");
    try {
      const result = await fetchSystemJson(`/api/system/admin/students/${row.id}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "leader" }),
        retries: 1,
        dedupeWindowMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "update_failed");
      dispatchSystemRealtime({ table: "profiles", action: "update" });
      dispatchSystemRealtime({ table: "sidebar_counts", action: "update" });
      setExpanded((prev) => {
        if (!prev.has(row.id)) return prev;
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      setChildren((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, row.id)) return prev;
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await load({ forceFresh: true });
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      clearRowPending(row.id);
    }
  };

  const phoneInvalid = form.phone.trim()
    ? !PHONE_REGEX.test(form.phone.trim().replace(/[\s-]/g, ""))
    : false;
  const passwordOk = form.password ? isStrongSystemPassword(form.password) : false;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "助教管理" : "Assistants"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? "超管与团队长可创建助教账号；超管与团队长均可冻结、删除或升为团队长。"
            : "Super admins and leaders can create assistants; both can manage status or promote."}
        </div>
      </div>

      {meRole === "leader" || meRole === "super_admin" ? (
        <form onSubmit={createAssistant} className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="text-white/85 font-semibold">{locale === "zh" ? "创建助教" : "Create assistant"}</div>
          <div className="mt-2 text-xs text-white/55">
            {locale === "zh"
              ? "超管创建的助教归属超管名下。"
              : "Assistants created by super admins belong to the super admin."}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs text-white/55 mb-2">{locale === "zh" ? "姓名" : "Full name"}</div>
              <input
                value={form.fullName}
                onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
                placeholder={locale === "zh" ? "请输入姓名" : "Enter name"}
                required
              />
            </div>
            <div>
              <div className="text-xs text-white/55 mb-2">{locale === "zh" ? "邮箱" : "Email"}</div>
              <input
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
                placeholder="name@example.com"
                required
              />
            </div>
            <div>
              <div className="text-xs text-white/55 mb-2">{locale === "zh" ? "手机号" : "Phone"}</div>
              <input
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
                placeholder={locale === "zh" ? "请输入手机号" : "Phone number"}
                required
              />
              {phoneInvalid ? (
                <div className="mt-2 text-xs text-rose-200/90">
                  {locale === "zh" ? "手机号格式不正确。" : "Invalid phone number."}
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-xs text-white/55 mb-2">{locale === "zh" ? "初始密码" : "Initial password"}</div>
              <input
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                className={[
                  "w-full rounded-xl border bg-white/5 px-3 py-2 text-white/85 text-sm",
                  form.password && !passwordOk ? "border-rose-400/30" : "border-white/10"
                ].join(" ")}
                placeholder={locale === "zh" ? "至少 8 位" : "8+ chars"}
                required
                type="password"
              />
            </div>
            <div className="md:col-span-2 flex items-center justify-end">
              <button
                type="submit"
                disabled={creating || !passwordOk || phoneInvalid}
                className="rounded-xl bg-white/10 border border-white/20 px-4 py-2 text-white hover:bg-white/15 disabled:opacity-50"
              >
                {creating ? (locale === "zh" ? "创建中..." : "Creating...") : locale === "zh" ? "创建助教" : "Create"}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 text-white/85 font-semibold">
          {locale === "zh" ? "助教列表" : "Assistant list"}
        </div>

        {loading ? (
          <div className="p-6 text-white/60">{locale === "zh" ? "加载中..." : "Loading..."}</div>
        ) : null}
        {!loading && !items.length ? (
          <div className="p-6 text-white/60">{locale === "zh" ? "暂无数据" : "No items"}</div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-white/50">
              <tr className="border-b border-white/10">
                <th className="px-6 py-3 text-left min-w-[180px] !max-w-none !whitespace-nowrap">
                  {locale === "zh" ? "姓名" : "Name"}
                </th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "邮箱" : "Email"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "手机号" : "Phone"}</th>
                {meRole === "super_admin" ? (
                  <th className="px-6 py-3 text-left">{locale === "zh" ? "所属团队长" : "Leader"}</th>
                ) : null}
                <th className="px-6 py-3 text-left">{locale === "zh" ? "状态" : "Status"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "最近登录" : "Last login"}</th>
                <th className="px-6 py-3 text-right">{locale === "zh" ? "操作" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {pageItems.map((row) => {
                const leader = row.leader || leaderById.get(row.leader_id || "");
                const leaderLabel = leader?.full_name || leader?.email || "-";
                const status = row.status === "frozen" ? "frozen" : "active";
                const isOpen = expanded.has(row.id);
                const rowAction = rowPendingAction[row.id] || null;
                const rowBusy = Boolean(rowAction);
                const childRows = children[row.id] || [];
                const childLoading = childrenLoading[row.id];
                const childErr = childrenError[row.id];
                const colSpan = meRole === "super_admin" ? 7 : 6;
                return (
                  <React.Fragment key={row.id}>
                    <tr className="hover:bg-white/5">
                      <td className="px-6 py-4 text-white/85 font-semibold min-w-[200px] !max-w-none !whitespace-nowrap">
                        <Tooltip content={row.full_name || "-"}>
                          <span className="system-name">{row.full_name || "-"}</span>
                        </Tooltip>
                      </td>
                      <td className="px-6 py-4 text-white/70 max-w-[240px] truncate">{row.email || "-"}</td>
                      <td className="px-6 py-4 text-white/70">{row.phone || "-"}</td>
                      {meRole === "super_admin" ? (
                        <td className="px-6 py-4 text-white/70">{leaderLabel}</td>
                      ) : null}
                      <td className="px-6 py-4 text-white/70">
                        <span className={status === "active" ? "text-emerald-300" : "text-rose-300"}>{status}</span>
                      </td>
                      <td className="px-6 py-4 text-white/60">{formatTime(row.last_login_at, locale)}</td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(row.id)}
                          disabled={rowBusy}
                          className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 disabled:opacity-50"
                        >
                          {locale === "zh" ? (isOpen ? "收起学员" : "学员名单") : isOpen ? "Hide students" : "Students"}
                        </button>
                        <a
                          href={`/${locale}/system/admin/assistants/${row.id}`}
                          className="ml-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
                        >
                          {locale === "zh" ? "查看助教详情" : "View assistant details"}
                        </a>
                        <button
                          type="button"
                          onClick={() => promoteToLeader(row)}
                          disabled={rowBusy}
                          className="ml-2 px-3 py-1.5 rounded-xl bg-sky-500/10 border border-sky-400/20 text-sky-100 hover:bg-sky-500/15 disabled:opacity-50"
                        >
                          {rowAction === "promote"
                            ? locale === "zh"
                              ? "升级中..."
                              : "Promoting..."
                            : locale === "zh"
                              ? "升为团队长"
                              : "Promote"}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleStatus(row)}
                          disabled={rowBusy}
                          className="ml-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-50"
                        >
                          {rowAction === "status"
                            ? locale === "zh"
                              ? "处理中..."
                              : "Processing..."
                            : row.status === "active"
                              ? locale === "zh"
                                ? "冻结"
                                : "Freeze"
                              : locale === "zh"
                                ? "解冻"
                                : "Unfreeze"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteAssistant(row)}
                          disabled={rowBusy}
                          className="ml-2 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-400/20 text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
                        >
                          {rowAction === "delete"
                            ? locale === "zh"
                              ? "删除中..."
                              : "Deleting..."
                            : locale === "zh"
                              ? "删除"
                              : "Delete"}
                        </button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="bg-white/[0.03]">
                        <td colSpan={colSpan} className="px-6 py-4">
                          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="text-white/85 text-sm font-semibold">
                              {locale === "zh" ? "该助教创建的学员" : "Students created by this assistant"}
                            </div>
                            {childLoading ? (
                              <div className="mt-3 text-white/60 text-sm">
                                {locale === "zh" ? "加载中…" : "Loading…"}
                              </div>
                            ) : null}
                            {childErr ? (
                              <div className="mt-3 text-rose-200 text-sm">{childErr}</div>
                            ) : null}
                            {!childLoading && !childErr && !childRows.length ? (
                              <div className="mt-3 text-white/60 text-sm">
                                {locale === "zh" ? "暂无学员" : "No students"}
                              </div>
                            ) : null}
                            {!childLoading && !childErr && childRows.length ? (
                              <div className="mt-3 overflow-x-auto">
                                <table className="min-w-full text-xs text-white/70">
                                  <thead className="text-white/50">
                                    <tr>
                                      <th className="py-2 text-left min-w-[160px] !whitespace-nowrap">
                                        {locale === "zh" ? "姓名" : "Name"}
                                      </th>
                                      <th className="py-2 text-left">{locale === "zh" ? "邮箱" : "Email"}</th>
                                      <th className="py-2 text-left">{locale === "zh" ? "手机" : "Phone"}</th>
                                      <th className="py-2 text-left">{locale === "zh" ? "角色" : "Role"}</th>
                                      <th className="py-2 text-left">{locale === "zh" ? "状态" : "Status"}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/10">
                                    {childRows.map((student) => (
                                      <tr key={student.id}>
                                        <td className="py-2 text-white/85 font-semibold min-w-[160px] !whitespace-nowrap !max-w-none">
                                          <span className="system-name">{student.full_name || "-"}</span>
                                        </td>
                                        <td className="py-2">{student.email || "-"}</td>
                                        <td className="py-2">{student.phone || "-"}</td>
                                        <td className="py-2">{student.role}</td>
                                        <td className="py-2">
                                          <span
                                            className={
                                              student.status === "active" ? "text-emerald-300" : "text-rose-300"
                                            }
                                          >
                                            {student.status}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : null}
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
