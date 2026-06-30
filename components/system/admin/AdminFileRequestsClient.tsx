"use client";

import React from "react";

import { dispatchPendingDelta, dispatchSystemRealtime } from "@/lib/system/realtime";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { ClientDateTime } from "@/components/system/ClientDateTime";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { PaginationControls } from "@/components/ui/PaginationControls";

type RequestItem = {
  user_id: string;
  file_id: string;
  requested_at?: string | null;
  user?: {
    id: string;
    full_name?: string;
    email?: string | null;
    phone?: string | null;
    support_name?: string | null;
    assistant_name?: string | null;
    coach_name?: string | null;
  } | null;
  file?: { id: string; category?: string | null; name?: string | null; description?: string | null } | null;
};

const REJECTION_REASONS = ["资料不完整", "不符合要求", "名额已满", "重复申请", "其他"] as const;
type RejectionReason = (typeof REJECTION_REASONS)[number];

export function AdminFileRequestsClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<RequestItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [total, setTotal] = React.useState(0);

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [studentInput, setStudentInput] = React.useState("");
  const [fileInput, setFileInput] = React.useState("");
  const [studentQuery, setStudentQuery] = React.useState("");
  const [fileQuery, setFileQuery] = React.useState("");
  const [rejectReason, setRejectReason] = React.useState<Record<string, string>>({});
  const [bulkRejectReason, setBulkRejectReason] = React.useState<RejectionReason>("其他");
  const loadSeqRef = React.useRef(0);
  const recentMutationAtRef = React.useRef(0);

  const keyOf = React.useCallback((it: Pick<RequestItem, "user_id" | "file_id">) => `${it.user_id}:${it.file_id}`, []);

  const selectedItems = React.useMemo(() => {
    const byKey = new Map(items.map((it) => [keyOf(it), it]));
    return Array.from(selected)
      .map((k) => byKey.get(k))
      .filter(Boolean) as RequestItem[];
  }, [items, keyOf, selected]);

  const allCurrentPageSelected = React.useMemo(() => {
    if (!items.length) return false;
    return items.every((it) => selected.has(keyOf(it)));
  }, [items, keyOf, selected]);

  const pageCount = Math.max(1, Math.ceil(Math.max(total, 0) / Math.max(pageSize, 1)));

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      const nextStudent = studentInput.trim();
      const nextFile = fileInput.trim();
      setPage(1);
      setStudentQuery(nextStudent);
      setFileQuery(nextFile);
    }, 250);
    return () => window.clearTimeout(t);
  }, [fileInput, studentInput]);

  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const load = React.useCallback(async (inputForceFresh = false) => {
    let forceFresh = inputForceFresh;
    if (!forceFresh && Date.now() - recentMutationAtRef.current < 15_000) {
      forceFresh = true;
    }
    const seq = ++loadSeqRef.current;
    if (!items.length) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      if (studentQuery) params.set("studentQuery", studentQuery);
      if (fileQuery) params.set("fileQuery", fileQuery);
      if (forceFresh) params.set("fresh", "1");
      const dedupeKey = `admin-file-requests:list:${page}:${pageSize}:${studentQuery}:${fileQuery}:fresh:${forceFresh ? 1 : 0}`;
      const result = await fetchSystemJson<{ ok?: boolean; items?: RequestItem[]; total?: number }>(
        `/api/system/admin/files/requests?${params.toString()}`,
        {
          fresh: forceFresh,
          dedupeKey,
          retries: 2,
          retryBaseMs: 260,
          retryMaxMs: 1500,
          dedupeWindowMs: forceFresh ? 0 : 700,
          preferStale: false,
          revalidateInBackground: false,
          staleTtlMs: 0
        }
      );
      if (!result.ok) throw new Error(result.errorCode || "load_failed");

      if (seq !== loadSeqRef.current) return;
      const body = (result.body || {}) as any;
      const nextItems = Array.isArray(body.items) ? (body.items as RequestItem[]) : [];
      setItems(nextItems);
      setTotal(Number(body.total || 0));
      setSelected((prev) => {
        const keep = new Set(nextItems.map((it) => keyOf(it)));
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
  }, [fileQuery, items.length, keyOf, page, pageSize, studentQuery]);

  React.useEffect(() => {
    void load(false);
  }, [load]);

  useSystemRealtimeRefresh(() => void load(false), {
    tables: ["file_access_requests"],
    throttleMs: 2500,
    globalThrottleMs: 3200,
    dedupeKey: `admin-file-requests:list:${page}:${pageSize}:${studentQuery}:${fileQuery}`
  });

  const reviewBulk = async (payload: {
    items: Array<{ userId: string; fileId: string }>;
    action: "approve" | "reject";
    reason?: string;
  }) => {
    const result = await fetchSystemJson("/api/system/admin/files/review-bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      retries: 1,
      retryBaseMs: 220,
      retryMaxMs: 1200
    });
    if (!result.ok) throw new Error(result.errorCode || "update_failed");
  };

  const collectAllPendingTargets = React.useCallback(async () => {
    const all = new Map<string, { userId: string; fileId: string }>();
    const scanPageSize = 200;
    let scanPage = 1;
    let knownTotal = 0;
    while (scanPage === 1 || (scanPage - 1) * scanPageSize < knownTotal) {
      const params = new URLSearchParams({
        page: String(scanPage),
        pageSize: String(scanPageSize),
        fresh: "1"
      });
      if (studentQuery) params.set("studentQuery", studentQuery);
      if (fileQuery) params.set("fileQuery", fileQuery);
      const result = await fetchSystemJson<{ ok?: boolean; items?: RequestItem[]; total?: number }>(
        `/api/system/admin/files/requests?${params.toString()}`,
        {
          fresh: true,
          dedupeKey: `admin-file-requests:scan:${studentQuery}:${fileQuery}:${scanPage}`,
          dedupeWindowMs: 0,
          preferStale: false,
          revalidateInBackground: false,
          staleTtlMs: 0,
          retries: 2,
          retryBaseMs: 260,
          retryMaxMs: 1500
        }
      );
      if (!result.ok) throw new Error(result.errorCode || "load_failed");
      const body = (result.body || {}) as any;
      const pageItems = Array.isArray(body.items) ? (body.items as RequestItem[]) : [];
      knownTotal = Math.max(knownTotal, Number(body.total || 0));
      for (const it of pageItems) {
        const k = keyOf(it);
        all.set(k, { userId: it.user_id, fileId: it.file_id });
      }
      if (!pageItems.length) break;
      scanPage += 1;
      if (scanPage > 80) break;
    }
    return Array.from(all.values());
  }, [fileQuery, keyOf, studentQuery]);

  const approveAll = async () => {
    if (busyKey === "ALL") return;
    setBusyKey("ALL");
    setError(null);
    try {
      const targets = await collectAllPendingTargets();
      if (!targets.length) {
        setSelected(new Set());
        setItems([]);
        setTotal(0);
        return;
      }
      const chunkSize = 120;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const batch = targets.slice(i, i + chunkSize);
        await reviewBulk({ items: batch, action: "approve" });
      }
      const dec = targets.length;
      const removeKeys = new Set(targets.map((it) => `${it.userId}:${it.fileId}`));
      setSelected(new Set());
      setItems((prev) => prev.filter((row) => !removeKeys.has(keyOf(row))));
      setTotal((prev) => Math.max(0, prev - dec));
      recentMutationAtRef.current = Date.now();
      dispatchPendingDelta({ fileAccess: -dec });
      dispatchSystemRealtime({ table: "file_access_requests", action: "update" });
      await load(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyKey(null);
    }
  };

  const reviewOne = async (it: RequestItem, action: "approve" | "reject") => {
    const k = keyOf(it);
    setBusyKey(k);
    setError(null);
    try {
      await reviewBulk({
        items: [{ userId: it.user_id, fileId: it.file_id }],
        action,
        reason: action === "reject" ? rejectReason[k] || undefined : undefined
      });
      setRejectReason((p) => ({ ...p, [k]: "其他" }));
      setItems((prev) => prev.filter((row) => keyOf(row) !== k));
      recentMutationAtRef.current = Date.now();
      dispatchPendingDelta({ fileAccess: -1 });
      dispatchSystemRealtime({ table: "file_access_requests", action: "update" });
      await load(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyKey(null);
    }
  };

  const reviewSelected = async (action: "approve" | "reject") => {
    if (!selectedItems.length) return;
    setBusyKey("BULK");
    setError(null);
    try {
      const dec = selectedItems.length;
      await reviewBulk({
        items: selectedItems.map((it) => ({ userId: it.user_id, fileId: it.file_id })),
        action,
        reason: action === "reject" ? bulkRejectReason : undefined
      });
      setSelected(new Set());
      setBulkRejectReason("其他");
      setItems((prev) => {
        const removing = new Set(selectedItems.map((row) => keyOf(row)));
        return prev.filter((row) => !removing.has(keyOf(row)));
      });
      recentMutationAtRef.current = Date.now();
      dispatchPendingDelta({ fileAccess: -dec });
      dispatchSystemRealtime({ table: "file_access_requests", action: "update" });
      await load(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyKey(null);
    }
  };

  const toggleSelected = (it: RequestItem) => {
    const k = keyOf(it);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleSelectAllCurrentPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allCurrentPageSelected) {
        for (const it of items) next.delete(keyOf(it));
      } else {
        for (const it of items) next.add(keyOf(it));
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 flex items-center gap-3">
        <div>
          <div className="text-white/90 font-semibold text-xl">{locale === "zh" ? "文件权限审批" : "File access requests"}</div>
          <div className="mt-2 text-white/60 text-sm">
            {locale === "zh"
              ? "处理学员文件权限申请（支持筛选和批量）。"
              : "Review student file access requests (filters and bulk actions)."}
          </div>
        </div>
        <button
          type="button"
          disabled={busyKey === "ALL" || total <= 0}
          onClick={approveAll}
          className="ml-auto px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50"
        >
          {busyKey === "ALL"
            ? locale === "zh"
              ? "处理中..."
              : "Processing..."
            : locale === "zh"
              ? "一键审批通过"
              : "Approve all"}
        </button>
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 text-white/85 font-semibold">
          {locale === "zh" ? "待审批列表" : "Pending list"}
        </div>

        <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center gap-2">
          <input
            value={studentInput}
            onChange={(e) => setStudentInput(e.target.value)}
            className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
            placeholder={locale === "zh" ? "搜索学员：姓名/邮箱/手机" : "Search student: name/email/phone"}
          />
          <input
            value={fileInput}
            onChange={(e) => setFileInput(e.target.value)}
            className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
            placeholder={locale === "zh" ? "搜索文件：分类/名称" : "Search file: category/name"}
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
            onChange={(e) => setBulkRejectReason(e.target.value as RejectionReason)}
            className="min-w-[220px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          >
            {REJECTION_REASONS.map((r) => (
              <option key={r} value={r}>
                {locale === "zh" ? `拒绝原因：${r}` : `Reason: ${r}`}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-6 text-white/60">{locale === "zh" ? "加载中..." : "Loading..."}</div>
        ) : null}
        {!loading && !items.length ? (
          <div className="p-6 text-white/60">{locale === "zh" ? "暂无申请" : "No requests"}</div>
        ) : null}

        <div className="divide-y divide-white/10">
          {items.map((it) => {
            const k = keyOf(it);
            const fullName = String(it.user?.full_name || "").trim();
            const email = String(it.user?.email || "").trim();
            const emailName = email.includes("@") ? email.split("@")[0] : email;
            const supportName = String(it.user?.support_name || "").trim();
            const idFallback = it.user_id ? `${it.user_id.slice(0, 8)}...` : "-";
            const baseName = fullName || emailName || supportName || idFallback;
            const supportLabel = supportName && supportName !== baseName ? `（${supportName}）` : "";
            const userLabel = `${baseName}${supportLabel}`;
            const userContact = [it.user?.email, it.user?.phone].filter(Boolean).join(" · ");
            const fileLabel = `${it.file?.category || ""} ${it.file?.name || ""}`.trim() || it.file_id;
            return (
              <div key={k} className="px-6 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(k)}
                    onChange={() => toggleSelected(it)}
                    className="h-4 w-4 accent-sky-400"
                    aria-label="select"
                  />
                  <div className="text-white/90 font-semibold whitespace-nowrap">{userLabel}</div>
                  <div className="text-xs text-white/50">{userContact ? `· ${userContact}` : ""}</div>
                  <div className="ml-auto text-xs text-white/50">
                    <ClientDateTime value={it.requested_at} />
                  </div>
                </div>
                <div className="mt-2 text-sm text-white/75">{fileLabel}</div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busyKey === k}
                    onClick={() => reviewOne(it, "approve")}
                    className="px-3 py-1.5 rounded-xl bg-emerald-400/15 border border-emerald-400/30 text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
                  >
                    {busyKey === k
                      ? locale === "zh"
                        ? "处理中..."
                        : "Processing..."
                      : locale === "zh"
                        ? "通过"
                        : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === k}
                    onClick={() => reviewOne(it, "reject")}
                    className="px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-400/20 text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
                  >
                    {busyKey === k
                      ? locale === "zh"
                        ? "处理中..."
                        : "Processing..."
                      : locale === "zh"
                        ? "拒绝"
                        : "Reject"}
                  </button>
                  <select
                    value={(rejectReason[k] || "其他") as RejectionReason}
                    onChange={(e) => setRejectReason((p) => ({ ...p, [k]: e.target.value }))}
                    className="ml-auto min-w-[240px] rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/85"
                  >
                    {REJECTION_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {locale === "zh" ? `拒绝原因：${r}` : `Reason: ${r}`}
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
            onClick={toggleSelectAllCurrentPage}
            className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"
          >
            {allCurrentPageSelected
              ? locale === "zh"
                ? "取消全选"
                : "Clear all"
              : locale === "zh"
                ? "全选当前页"
                : "Select all"}
          </button>
          <span className="ml-auto">
            {locale === "zh" ? "当前页显示" : "Showing"} {items.length} · {locale === "zh" ? "已选" : "Selected"} {selectedItems.length}
          </span>
        </div>
        {!loading && total > 0 ? (
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
        ) : null}
      </div>
    </div>
  );
}
