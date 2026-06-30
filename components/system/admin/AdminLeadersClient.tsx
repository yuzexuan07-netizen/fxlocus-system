"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { isStrongSystemPassword } from "@/lib/system/passwordPolicy";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";

type LeaderRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: "leader" | "super_admin";
  status: "active" | "frozen";
  created_at?: string;
  last_login_at?: string | null;
};

type AuditRow = {
  id: string;
  created_at: string;
  from_role: string;
  to_role: string;
  reason: string | null;
  target_id: string;
  actor_id: string;
  target?: { full_name: string | null; email: string | null } | null;
  actor?: { full_name: string | null; email: string | null } | null;
};

const PHONE_REGEX = /^\+?[0-9]{6,20}$/;

function roleLabelZh(role: string) {
  if (role === "super_admin") return "超管";
  if (role === "leader") return "团队长";
  if (role === "trader") return "数据采集员";
  if (role === "coach") return "教练";
  if (role === "student") return "学员";
  return role;
}

function formatFieldErrors(details: any) {
  if (!details || typeof details !== "object") return "";
  const formErrors = Array.isArray(details.formErrors) ? details.formErrors.filter(Boolean) : [];
  const fieldErrors = details.fieldErrors && typeof details.fieldErrors === "object" ? details.fieldErrors : {};
  const fieldMessages = Object.entries(fieldErrors).flatMap(([key, value]) => {
    if (!Array.isArray(value)) return [];
    return value.filter(Boolean).map((msg) => `${key}: ${msg}`);
  });
  const all = [...formErrors, ...fieldMessages].filter(Boolean);
  return all.length ? all.join("; ") : "";
}

function buildApiError(json: any, fallback: string) {
  const base = json?.error || fallback;
  const detail = formatFieldErrors(json?.details);
  return detail ? `${base}: ${detail}` : base;
}

export function AdminLeadersClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<LeaderRow[]>([]);
  const [audit, setAudit] = React.useState<AuditRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [createForm, setCreateForm] = React.useState({
    email: "",
    fullName: "",
    phone: "",
    password: "",
    reason: ""
  });
  const [creating, setCreating] = React.useState(false);

  const [changeForm, setChangeForm] = React.useState({
    email: "",
    toRole: "leader" as "student" | "leader" | "super_admin",
    leaderId: "",
    reason: ""
  });
  const [changing, setChanging] = React.useState(false);
  const router = useRouter();

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [leadersResult, auditResult] = await Promise.all([
        fetchSystemJson<{ ok?: boolean; items?: LeaderRow[] }>("/api/system/admin/leaders/list", {
          dedupeKey: "leaders:list",
          retries: 2,
          retryBaseMs: 260,
          retryMaxMs: 1500
        }),
        fetchSystemJson<{ ok?: boolean; items?: AuditRow[] }>("/api/system/admin/leaders/audit", {
          dedupeKey: "leaders:audit",
          dedupeWindowMs: 1200,
          retries: 1
        })
      ]);

      const leadersJson = (leadersResult.body || null) as any;
      if (!leadersResult.ok || !leadersJson?.ok) {
        throw new Error(leadersJson?.error || leadersResult.errorCode || "load_failed");
      }
      setItems(Array.isArray(leadersJson.items) ? leadersJson.items : []);

      const auditJson = (auditResult.body || null) as any;
      if (auditResult.ok && auditJson?.ok) {
        setAudit(Array.isArray(auditJson.items) ? auditJson.items : []);
      }
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
    tables: ["profiles", "role_audit_logs"],
    throttleMs: 3000,
    globalThrottleMs: 3600,
    dedupeKey: "leaders:list"
  });

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(items);

  const createLeader = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const phone = createForm.phone.trim().replace(/[\s-]/g, "");
      if (!phone) {
        throw new Error(locale === "zh" ? "手机号为必填项" : "Phone number is required");
      }
      if (!PHONE_REGEX.test(phone)) {
        throw new Error(locale === "zh" ? "手机号格式不正确" : "Invalid phone number");
      }
      if (!isStrongSystemPassword(createForm.password)) {
        throw new Error(locale === "zh" ? "密码强度不足" : "Weak password");
      }
      const result = await fetchSystemJson("/api/system/admin/leaders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: createForm.email,
          fullName: createForm.fullName || undefined,
          phone,
          password: createForm.password,
          reason: createForm.reason || undefined
        }),
        retries: 1,
        dedupeWindowMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(buildApiError(json, result.errorCode || "create_failed"));
      setCreateForm({ email: "", fullName: "", phone: "", password: "", reason: "" });
      await load();
    } catch (e: any) {
      setError(e?.message || "create_failed");
    } finally {
      setCreating(false);
    }
  };

  const changeRoleByEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setChanging(true);
    setError(null);
    try {
      const result = await fetchSystemJson("/api/system/admin/leaders/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: changeForm.email,
          toRole: changeForm.toRole,
          leaderId: changeForm.toRole === "student" ? changeForm.leaderId || undefined : undefined,
          reason: changeForm.reason || undefined
        }),
        retries: 1,
        dedupeWindowMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(buildApiError(json, result.errorCode || "update_failed"));
      await load();
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setChanging(false);
    }
  };

  const quickChange = async (row: LeaderRow, toRole: "student" | "leader" | "super_admin") => {
    const confirmText =
      toRole === "super_admin"
        ? locale === "zh"
          ? "确认将该团队长升为超管？"
          : "Promote this leader to super admin?"
        : toRole === "student"
          ? locale === "zh"
            ? "确认将该团队长降为学员？其名下学员和下属团队长将移交给当前超管。"
            : "Demote this leader to student? Their students and sub-leaders will transfer to the current super admin."
          : locale === "zh"
            ? "确认将该超管降为团队长？"
            : "Demote this super admin to leader?";
    const ok = window.confirm(confirmText);
    if (!ok) return;

    const reason = window.prompt(locale === "zh" ? "请输入原因（可选）" : "Reason (optional)") || "";
    const leaderId = "";

    setError(null);
    try {
      const result = await fetchSystemJson("/api/system/admin/leaders/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetId: row.id,
          toRole,
          leaderId: toRole === "student" ? leaderId || undefined : undefined,
          reason: reason || undefined
        }),
        retries: 1,
        dedupeWindowMs: 0
      });
      const json = (result.body || null) as any;
      if (!result.ok || !json?.ok) throw new Error(buildApiError(json, result.errorCode || "update_failed"));
      await load();
    } catch (e: any) {
      setError(e?.message || "update_failed");
    }
  };

  const passwordOk = createForm.password ? isStrongSystemPassword(createForm.password) : false;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "团队长管理" : "Leaders"}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? "管理团队长账号、升降级，并记录审计日志。仅超管可用。"
            : "Manage leaders, change roles, and view audit logs (super admin only)."}
        </div>
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      <form onSubmit={createLeader} className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-3">
        <div className="text-white/85 font-semibold">{locale === "zh" ? "创建团队长账号" : "Create leader"}</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <input
            value={createForm.email}
            onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
            placeholder="Email"
            required
          />
          <input
            value={createForm.fullName}
            onChange={(e) => setCreateForm((p) => ({ ...p, fullName: e.target.value }))}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
            placeholder={locale === "zh" ? "姓名（可选）" : "Full name (optional)"}
          />
          <input
            value={createForm.phone}
            onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
            placeholder={locale === "zh" ? "手机号" : "Phone"}
            required
          />
          <input
            value={createForm.password}
            onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
            placeholder={locale === "zh" ? "初始密码" : "Initial password"}
            required
            type="password"
          />
          <input
            value={createForm.reason}
            onChange={(e) => setCreateForm((p) => ({ ...p, reason: e.target.value }))}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
            placeholder={locale === "zh" ? "原因（可选）" : "Reason (optional)"}
          />
          <button
            type="submit"
            disabled={creating || !passwordOk}
            className="rounded-xl bg-white/10 border border-white/20 px-4 py-2 text-white hover:bg-white/15 disabled:opacity-50"
          >
            {creating ? (locale === "zh" ? "创建中…" : "Creating…") : locale === "zh" ? "创建" : "Create"}
          </button>
        </div>
        <div className="text-xs text-white/45">
          {locale === "zh"
            ? "密码规则：大写小写+数字+特殊字符，长度8-64"
            : "Password rule: upper+lower+digit+special, 8-64 chars."}
        </div>
      </form>

      <form onSubmit={changeRoleByEmail} className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-3">
        <div className="text-white/85 font-semibold">{locale === "zh" ? "按邮箱升降级" : "Change role by email"}</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input
            value={changeForm.email}
            onChange={(e) => setChangeForm((p) => ({ ...p, email: e.target.value }))}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
            placeholder="Email"
            required
          />
          <select
            value={changeForm.toRole}
            onChange={(e) => setChangeForm((p) => ({ ...p, toRole: e.target.value as any }))}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
          >
            <option value="leader">{locale === "zh" ? "升为团队长" : "Promote to leader"}</option>
            <option value="super_admin">{locale === "zh" ? "升为超管" : "Promote to super admin"}</option>
            <option value="student">{locale === "zh" ? "降为学员" : "Demote to student"}</option>
          </select>
          <input
            value={changeForm.leaderId}
            onChange={(e) => setChangeForm((p) => ({ ...p, leaderId: e.target.value }))}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
            placeholder={locale === "zh" ? "leader_id（仅降为学员时可选）" : "leader_id (optional for student)"}
            disabled={changeForm.toRole !== "student"}
          />
          <div className="flex items-center gap-2">
            <input
              value={changeForm.reason}
              onChange={(e) => setChangeForm((p) => ({ ...p, reason: e.target.value }))}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
              placeholder={locale === "zh" ? "原因（可选）" : "Reason (optional)"}
            />
            <button
              type="submit"
              disabled={changing}
              className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50"
            >
              {changing ? (locale === "zh" ? "处理中…" : "Updating…") : locale === "zh" ? "执行" : "Apply"}
            </button>
          </div>
        </div>
      </form>

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 text-white/85 font-semibold">
          {locale === "zh" ? "团队长列表" : "Leaders"}
        </div>

        {loading ? <div className="p-6 text-white/60">{locale === "zh" ? "加载中…" : "Loading…"}</div> : null}
        {!loading && !items.length ? <div className="p-6 text-white/60">{locale === "zh" ? "暂无数据" : "No items"}</div> : null}

        <div className="divide-y divide-white/10">
          {pageItems.map((row) => (
            <div key={row.id} className="px-6 py-4 flex flex-wrap items-center gap-3">
              <div className="min-w-[260px]">
                <div className="text-white/90 font-semibold">
                  <span className="system-name">{row.full_name || "-"}</span>
                </div>
                <div className="text-xs text-white/50 mt-1">
                  {row.email || "-"} {row.phone ? `· ${row.phone}` : ""}
                </div>
              </div>
              <div className="text-xs text-white/50">
                {locale === "zh" ? "角色" : "Role"}:{" "}
                <span className="text-white/80">{locale === "zh" ? roleLabelZh(row.role) : row.role}</span>
              </div>
              <div className="text-xs text-white/50">
                {locale === "zh" ? "状态" : "Status"}:{" "}
                <span className={row.status === "active" ? "text-emerald-300" : "text-rose-300"}>
                  {row.status}
                </span>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push(`/${locale}/system/admin/leaders/${row.id}`)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
                >
                  {locale === "zh" ? "查看团队长详情" : "View leader details"}
                </button>
                {row.role === "leader" ? (
                  <button
                    type="button"
                    onClick={() => quickChange(row, "super_admin")}
                    className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
                  >
                    {locale === "zh" ? "升为超管" : "Promote"}
                  </button>
                ) : null}
                {row.role === "super_admin" ? (
                  <button
                    type="button"
                    onClick={() => quickChange(row, "leader")}
                    className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
                  >
                    {locale === "zh" ? "降为团队长" : "Demote"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => quickChange(row, "student")}
                  className="px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-400/20 text-rose-100 hover:bg-rose-500/15"
                >
                  {locale === "zh" ? "降为学员" : "To student"}
                </button>
              </div>
            </div>
          ))}
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

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 text-white/85 font-semibold">
          {locale === "zh" ? "审计日志" : "Audit logs"}
        </div>
        {!audit.length ? (
          <div className="p-6 text-white/60">{locale === "zh" ? "暂无数据" : "No items"}</div>
        ) : (
          <div className="divide-y divide-white/10">
            {audit.slice(0, 50).map((a) => (
              <div key={a.id} className="px-6 py-3 text-sm text-white/75 flex flex-wrap gap-2">
                <div className="text-white/50">
                  <ClientDateTime value={a.created_at} fallback="-" />
                </div>
                <div className="text-white/80">
                  {(a.actor?.full_name || a.actor?.email || a.actor_id || "-") as any}
                </div>
                <div className="text-white/50">{locale === "zh" ? "把" : "changed"}</div>
                <div className="text-white/80">
                  {(a.target?.full_name || a.target?.email || a.target_id || "-") as any}
                </div>
                <div className="text-white/50">{locale === "zh" ? "从" : "from"}</div>
                <div className="text-white/80">{locale === "zh" ? roleLabelZh(a.from_role) : a.from_role}</div>
                <div className="text-white/50">{locale === "zh" ? "改为" : "to"}</div>
                <div className="text-white/80">{locale === "zh" ? roleLabelZh(a.to_role) : a.to_role}</div>
                {a.reason ? <div className="text-white/50">{`· ${a.reason}`}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
