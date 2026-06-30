"use client";

import React from "react";

import LadderImage from "@/components/system/LadderImage";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { LADDER_IMAGE_URL, LADDER_REFRESH_MS } from "@/lib/system/ladderConfig";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { dispatchPendingDelta, dispatchSystemRealtime } from "@/lib/system/realtime";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";

type LadderRequestItem = {
  user_id: string;
  requested_at?: string | null;
  user?: { id: string; full_name?: string; email?: string | null; phone?: string | null } | null;
};

type LadderConfig = {
  imageUrl: string;
  refreshMs: number;
  updatedAt?: string | null;
};

const REJECT_OPTIONS = ["资料不完整", "不符合要求", "名额已满", "重复申请", "其他"] as const;

export function AdminLadderClient({ locale }: { locale: "zh" | "en" }) {
  const [error, setError] = React.useState<string | null>(null);

  const [items, setItems] = React.useState<LadderRequestItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  const [meRole, setMeRole] = React.useState<"leader" | "super_admin" | null>(null);
  const [config, setConfig] = React.useState<LadderConfig>({
    imageUrl: LADDER_IMAGE_URL,
    refreshMs: LADDER_REFRESH_MS
  });
  const [configOpen, setConfigOpen] = React.useState(false);
  const [configUrl, setConfigUrl] = React.useState(LADDER_IMAGE_URL);
  const [configMs, setConfigMs] = React.useState(LADDER_REFRESH_MS);
  const [configSaving, setConfigSaving] = React.useState(false);

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [filterStudent, setFilterStudent] = React.useState("");
  const [rejectReason, setRejectReason] = React.useState<Record<string, string>>({});
  const [bulkRejectReason, setBulkRejectReason] = React.useState("");
  const loadSeqRef = React.useRef(0);
  const recentMutationAtRef = React.useRef(0);

  const filtered = React.useMemo(() => {
    const needle = filterStudent.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => {
      const hay = `${it.user?.full_name || ""} ${it.user?.email || ""} ${it.user?.phone || ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [filterStudent, items]);

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(filtered, {
    deps: [filterStudent]
  });

  const selectedItems = React.useMemo(() => {
    const byId = new Map(items.map((it) => [it.user_id, it]));
    return Array.from(selected)
      .map((id) => byId.get(id))
      .filter(Boolean) as LadderRequestItem[];
  }, [items, selected]);

  const allFilteredSelected = React.useMemo(() => {
    if (!filtered.length) return false;
    return filtered.every((it) => selected.has(it.user_id));
  }, [filtered, selected]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { role?: string | null } }>("/api/system/me", {
          dedupeKey: "admin-ladder:me",
          retries: 1,
          retryBaseMs: 200,
          retryMaxMs: 1000
        });
        const json = (result.body || {}) as any;
        if (!alive) return;
        const role = result.ok ? String(json?.user?.role || "") : "";
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

  const loadRequests = React.useCallback(async (inputForceFresh = false) => {
    let forceFresh = inputForceFresh;
    if (!forceFresh && Date.now() - recentMutationAtRef.current < 15_000) {
      forceFresh = true;
    }
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const requestUrl = forceFresh ? "/api/system/admin/ladder/requests?fresh=1" : "/api/system/admin/ladder/requests";
      const result = await fetchSystemJson<{ ok?: boolean; items?: LadderRequestItem[] }>(
        requestUrl,
        {
          fresh: forceFresh,
          dedupeKey: "admin-ladder:requests",
          dedupeWindowMs: forceFresh ? 0 : 900,
          preferStale: !forceFresh,
          revalidateInBackground: !forceFresh,
          staleTtlMs: 3 * 60_000,
          retries: 2,
          retryBaseMs: 260,
          retryMaxMs: 1500
        }
      );
      if (!result.ok) throw new Error(result.errorCode || "load_failed");
      if (seq !== loadSeqRef.current) return;
      const body = (result.body || {}) as any;
      const nextItems = Array.isArray(body.items) ? (body.items as LadderRequestItem[]) : [];
      setItems(nextItems);
      setSelected((prev) => {
        const keep = new Set(nextItems.map((it) => it.user_id));
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
  }, []);

  const loadConfig = React.useCallback(async () => {
    try {
      const result = await fetchSystemJson<{ ok?: boolean; config?: LadderConfig }>(
        "/api/system/admin/ladder/config",
        {
          dedupeKey: "admin-ladder:config",
          retries: 1,
          retryBaseMs: 200,
          retryMaxMs: 1200
        }
      );
      if (!result.ok) return;
      const json = (result.body || {}) as any;
      const next = {
        imageUrl: String(json.config?.imageUrl || LADDER_IMAGE_URL),
        refreshMs: Number(json.config?.refreshMs || LADDER_REFRESH_MS),
        updatedAt: json.config?.updatedAt || null
      };
      setConfig(next);
      setConfigUrl(next.imageUrl);
      setConfigMs(next.refreshMs);
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    void loadRequests(true);
  }, [loadRequests]);

  React.useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useSystemRealtimeRefresh(
    () => {
      void loadRequests(true);
      void loadConfig();
    },
    {
      tables: ["ladder_authorizations"],
      throttleMs: 3000,
      globalThrottleMs: 3800,
      dedupeKey: "admin-ladder:refresh"
    }
  );


  const reviewBulk = async (payload: { userIds: string[]; action: "approve" | "reject"; reason?: string }) => {
    const result = await fetchSystemJson("/api/system/admin/ladder/review-bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: payload.userIds.map((id) => ({ userId: id })),
        action: payload.action,
        reason: payload.reason
      }),
      retries: 1,
      retryBaseMs: 220,
      retryMaxMs: 1200
    });
    if (!result.ok) throw new Error(result.errorCode || "update_failed");
  };

  const reviewOne = async (userId: string, action: "approve" | "reject") => {
    const ok = window.confirm(
      locale === "zh"
        ? action === "approve"
          ? "确认通过该申请？"
          : "确认拒绝该申请？"
        : action === "approve"
          ? "Approve this request?"
          : "Reject this request?"
    );
    if (!ok) return;
    setBusyKey(userId);
    setError(null);
    try {
      await reviewBulk({
        userIds: [userId],
        action,
        reason: action === "reject" ? rejectReason[userId] || undefined : undefined
      });
      setRejectReason((p) => ({ ...p, [userId]: "" }));
      setItems((prev) => prev.filter((item) => item.user_id !== userId));
      recentMutationAtRef.current = Date.now();
      dispatchPendingDelta({ ladderRequests: -1 });
      dispatchSystemRealtime({ table: "ladder_authorizations", action: "update" });
      void loadRequests(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyKey(null);
    }
  };

  const reviewSelected = async (action: "approve" | "reject") => {
    if (!selectedItems.length) return;
    const ok = window.confirm(
      locale === "zh"
        ? action === "approve"
          ? `确认通过已选 ${selectedItems.length} 条申请？`
          : `确认拒绝已选 ${selectedItems.length} 条申请？`
        : action === "approve"
          ? `Approve ${selectedItems.length} selected requests?`
          : `Reject ${selectedItems.length} selected requests?`
    );
    if (!ok) return;
    setBusyKey("BULK");
    setError(null);
    try {
      const dec = selectedItems.length;
      await reviewBulk({
        userIds: selectedItems.map((it) => it.user_id),
        action,
        reason: action === "reject" ? bulkRejectReason || undefined : undefined
      });
      setSelected(new Set());
      setBulkRejectReason("");
      setItems((prev) => {
        const removing = new Set(selectedItems.map((item) => item.user_id));
        return prev.filter((item) => !removing.has(item.user_id));
      });
      recentMutationAtRef.current = Date.now();
      dispatchPendingDelta({ ladderRequests: -dec });
      dispatchSystemRealtime({ table: "ladder_authorizations", action: "update" });
      void loadRequests(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyKey(null);
    }
  };

  const approveAll = async () => {
    if (!items.length) return;
    const ok = window.confirm(
      locale === "zh" ? `确认通过全部 ${items.length} 条申请？` : `Approve all ${items.length} requests?`
    );
    if (!ok) return;
    setBusyKey("ALL");
    setError(null);
    try {
      const dec = items.length;
      await reviewBulk({ userIds: items.map((it) => it.user_id), action: "approve" });
      setSelected(new Set());
      setItems([]);
      recentMutationAtRef.current = Date.now();
      dispatchPendingDelta({ ladderRequests: -dec });
      dispatchSystemRealtime({ table: "ladder_authorizations", action: "update" });
      void loadRequests(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyKey(null);
    }
  };

  const saveConfig = async () => {
    if (meRole !== "super_admin") return;
    const ok = window.confirm(locale === "zh" ? "确认更新天梯配置？" : "Update ladder settings?");
    if (!ok) return;
    setConfigSaving(true);
    setError(null);
    try {
      const result = await fetchSystemJson("/api/system/admin/ladder/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageUrl: configUrl, refreshMs: configMs }),
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      if (!result.ok) throw new Error(result.errorCode || "save_failed");
      await loadConfig();
      setConfigOpen(false);
    } catch (e: any) {
      setError(e?.message || "save_failed");
    } finally {
      setConfigSaving(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const it of filtered) next.delete(it.user_id);
      } else {
        for (const it of filtered) next.add(it.user_id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 flex items-center gap-3">
        <div>
          <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "天梯管理" : "Ladder admin"}</div>
          <div className="mt-2 text-white/60 text-sm">
            {locale === "zh"
              ? "审批天梯申请（支持多选批量）。"
              : "Review ladder requests (bulk supported)."}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {meRole === "super_admin" ? (
            <button
              type="button"
              onClick={() => setConfigOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
            >
              {locale === "zh" ? "编辑链接" : "Edit link"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busyKey === "ALL" || !items.length}
            onClick={approveAll}
            className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50"
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
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="mb-3 text-white/85 font-semibold">
          {locale === "zh" ? "天梯预览（自动刷新）" : "Ladder preview (auto refresh)"}
        </div>
        <LadderImage baseUrl={config.imageUrl} intervalMs={config.refreshMs} />
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 text-white/85 font-semibold">
          {locale === "zh" ? "待审批申请" : "Pending requests"}
        </div>

        <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center gap-2">
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
            onChange={(e) => setBulkRejectReason(e.target.value)}
            className="min-w-[220px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          >
            <option value="">
              {locale === "zh" ? "批量拒绝原因（可选）" : "Bulk reject reason (optional)"}
            </option>
            {REJECT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
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
            const contact = [it.user?.email, it.user?.phone].filter(Boolean).join(" · ");
            return (
              <div key={it.user_id} className="px-6 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(it.user_id)}
                    onChange={() => toggleSelected(it.user_id)}
                    className="h-4 w-4 accent-sky-400"
                    aria-label="select"
                  />
                  <div className="text-white/90 font-semibold whitespace-nowrap">
                    <span className="system-name">{it.user?.full_name || it.user_id}</span>
                  </div>
                  <div className="text-xs text-white/50">{contact ? `· ${contact}` : ""}</div>
                  <div className="ml-auto text-xs text-white/50">
                    <ClientDateTime value={it.requested_at} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busyKey === it.user_id}
                    onClick={() => reviewOne(it.user_id, "approve")}
                    className="px-3 py-1.5 rounded-xl bg-emerald-400/15 border border-emerald-400/30 text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
                  >
                    {busyKey === it.user_id
                      ? locale === "zh"
                        ? "处理中..."
                        : "Processing..."
                      : locale === "zh"
                        ? "通过"
                        : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === it.user_id}
                    onClick={() => reviewOne(it.user_id, "reject")}
                    className="px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-400/20 text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
                  >
                    {busyKey === it.user_id
                      ? locale === "zh"
                        ? "处理中..."
                        : "Processing..."
                      : locale === "zh"
                        ? "拒绝"
                        : "Reject"}
                  </button>
                  <select
                    value={rejectReason[it.user_id] || ""}
                    onChange={(e) => setRejectReason((p) => ({ ...p, [it.user_id]: e.target.value }))}
                    className="ml-auto min-w-[240px] rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/85"
                  >
                    <option value="">{locale === "zh" ? "拒绝原因（可选）" : "Reject reason (optional)"}</option>
                    {REJECT_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
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

      {configOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
          <div className="w-full max-w-[640px] rounded-3xl border border-white/10 bg-[#050a14] p-6">
            <div className="flex items-center gap-2">
              <div className="text-white/90 font-semibold">{locale === "zh" ? "天梯链接设置" : "Ladder link"}</div>
              <button
                type="button"
                onClick={() => setConfigOpen(false)}
                className="ml-auto px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
              >
                {locale === "zh" ? "关闭" : "Close"}
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <div className="text-xs text-white/55 mb-2">{locale === "zh" ? "图片链接" : "Image URL"}</div>
                <input
                  value={configUrl}
                  onChange={(e) => setConfigUrl(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
                  placeholder="https://"
                />
              </div>
              <div>
                <div className="text-xs text-white/55 mb-2">{locale === "zh" ? "刷新间隔（毫秒）" : "Refresh interval (ms)"}</div>
                <input
                  type="number"
                  min={1000}
                  max={300000}
                  value={configMs}
                  onChange={(e) => setConfigMs(Number(e.target.value || 0))}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white/85 text-sm"
                />
              </div>
              <div className="text-xs text-white/45">
                {config.updatedAt ? (
                  <span>
                    {locale === "zh" ? "最近更新" : "Updated"}: <ClientDateTime value={config.updatedAt} />
                  </span>
                ) : (
                  ""
                )}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                disabled={configSaving}
                onClick={saveConfig}
                className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50"
              >
                {configSaving ? (locale === "zh" ? "保存中…" : "Saving…") : locale === "zh" ? "保存" : "Save"}
              </button>
              <button
                type="button"
                disabled={configSaving}
                onClick={() => setConfigOpen(false)}
                className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                {locale === "zh" ? "取消" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
