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
  leader_id?: string | null;
};

type LeaderOption = { id: string; full_name: string | null; email: string | null };

type ClassicTradeAdminItem = {
  id: string;
  user_id: string;
  leader_id: string | null;
  reason: string;
  review_note?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
  image_url?: string | null;
  image_name?: string | null;
  image_mime_type?: string | null;
  user?: UserInfo | null;
};

function withQueryParam(url: string, key: string, value: string) {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  const encoded = encodeURIComponent(value);
  if (new RegExp(`([?&])${key}=`).test(raw)) {
    return raw.replace(new RegExp(`([?&])${key}=[^&]*`), `$1${key}=${encoded}`);
  }
  return `${raw}${raw.includes("?") ? "&" : "?"}${key}=${encoded}`;
}

function buildDownloadUrl(url: string, fileName?: string | null, mimeType?: string | null) {
  let next = withQueryParam(url, "disposition", "attachment");
  const safeName = String(fileName || "").trim();
  if (safeName) next = withQueryParam(next, "filename", safeName);
  const safeMime = String(mimeType || "").trim();
  if (safeMime) next = withQueryParam(next, "contentType", safeMime);
  return next;
}

export function AdminClassicTradesClient({ locale }: { locale: "zh" | "en" }) {
  const [items, setItems] = React.useState<ClassicTradeAdminItem[]>([]);
  const [leaders, setLeaders] = React.useState<LeaderOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const [leaderId, setLeaderId] = React.useState("");
  const [role, setRole] = React.useState<"leader" | "super_admin" | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<{ name: string; url: string } | null>(null);
  const loadSeqRef = React.useRef(0);
  const recentMutationAtRef = React.useRef(0);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { role?: string | null } }>("/api/system/me", {
          dedupeKey: "admin-classic-trades:me",
          retries: 1,
          retryBaseMs: 200,
          retryMaxMs: 1000
        });
        const json = (result.body || {}) as any;
        if (!alive) return;
        const r = result.ok ? String(json.user?.role || "") : "";
        if (r === "super_admin") setRole("super_admin");
        else if (r === "leader") setRole("leader");
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const load = React.useCallback(async (inputForceFresh = false) => {
    let forceFresh = inputForceFresh;
    if (!forceFresh && Date.now() - recentMutationAtRef.current < 15_000) {
      forceFresh = true;
    }
    const seq = ++loadSeqRef.current;
    if (!items.length) setLoading(true);
    if (forceFresh || !items.length) setError(null);
    try {
      const qs = leaderId ? `?leaderId=${encodeURIComponent(leaderId)}` : "";
      const requestUrl = forceFresh
        ? `/api/system/admin/classic-trades/list${qs ? `${qs}&fresh=1` : "?fresh=1"}`
        : `/api/system/admin/classic-trades/list${qs}`;
      const result = await fetchSystemJson<{ ok?: boolean; items?: ClassicTradeAdminItem[]; leaders?: LeaderOption[] }>(
        requestUrl,
        {
          fresh: forceFresh,
          dedupeKey: `admin-classic-trades:list:${leaderId || "__all__"}`,
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
      setItems(Array.isArray(body.items) ? body.items : []);
      setLeaders(Array.isArray(body.leaders) ? body.leaders : []);
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return;
      setError(e?.message || "load_failed");
    } finally {
      if (seq !== loadSeqRef.current) return;
      setLoading(false);
    }
  }, [items.length, leaderId]);

  React.useEffect(() => {
    void load(true);
  }, [load]);

  useSystemRealtimeRefresh(() => void load(true), {
    tables: ["classic_trades"],
    throttleMs: 3000,
    globalThrottleMs: 3800,
    dedupeKey: `admin-classic-trades:list:${leaderId || "__all__"}`
  });

  const markReviewed = async (entryId: string, withNote: boolean) => {
    const note = (notes[entryId] || "").trim();
    if (withNote && !note) {
      setError(locale === "zh" ? "请输入审批内容" : "Review note required.");
      return;
    }
    const ok = window.confirm(locale === "zh" ? "确认提交审批？" : "Submit review?");
    if (!ok) return;
    setBusyId(entryId);
    setError(null);
    try {
      const prevItem = items.find((item) => item.id === entryId) || null;
      const shouldDec = !prevItem?.reviewed_at;
      const result = await fetchSystemJson("/api/system/admin/classic-trades/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId, reviewNote: note || undefined }),
        retries: 1,
        retryBaseMs: 220,
        retryMaxMs: 1200
      });
      if (!result.ok) throw new Error(result.errorCode || "update_failed");
      setNotes((prev) => ({ ...prev, [entryId]: "" }));
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((item) =>
          item.id === entryId
            ? {
                ...item,
                reviewed_at: now,
                review_note: note || item.review_note
              }
            : item
        )
      );
      recentMutationAtRef.current = Date.now();
      if (shouldDec) dispatchPendingDelta({ classicTrades: -1 });
      dispatchSystemRealtime({ table: "classic_trades", action: "update" });
      void load(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyId(null);
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
    deps: [filter, leaderId]
  });

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">
          {locale === "zh" ? "模拟交易案例管理" : "Simulation Trade Cases"}
        </div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh"
            ? "查看学员提交的模拟交易案例并进行审批。"
            : "Review student simulation trade case submissions."}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 flex flex-wrap items-center gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-[220px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          placeholder={locale === "zh" ? "搜索：姓名/邮箱" : "Search: name/email"}
        />
        {role === "super_admin" ? (
          <select
            value={leaderId}
            onChange={(e) => setLeaderId(e.target.value)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          >
            <option value="">{locale === "zh" ? "全部团队长" : "All leaders"}</option>
            {leaders.map((leader) => (
              <option key={leader.id} value={leader.id}>
                {leader.full_name || leader.email || leader.id.slice(0, 6)}
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
          const name = it.user?.full_name || "-";
          const email = it.user?.email || "-";
          return (
            <div key={it.id} className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-white/90 font-semibold whitespace-nowrap">
                  <span className="system-name">{name}</span>
                </div>
                <div className="text-xs text-white/60">{email}</div>
                <div className={`text-xs ${statusClass}`}>{status}</div>
                <div className="ml-auto text-xs text-white/50">
                  <ClientDateTime value={it.created_at} />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                <button
                  type="button"
                  disabled={!it.image_url}
                  onClick={() => it.image_url && setPreview({ name: it.image_name || "Preview", url: it.image_url })}
                  className="group relative h-[140px] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                >
                  {it.image_url ? (
                    <img src={it.image_url} alt={it.image_name || "preview"} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-white/50">
                      {locale === "zh" ? "无预览" : "No preview"}
                    </div>
                  )}
                </button>
                <div className="space-y-3">
                  <div className="text-sm text-white/85 whitespace-pre-wrap">{it.reason}</div>
                  {it.review_note ? (
                    <div className="text-xs text-white/65">
                      {locale === "zh" ? "审批内容" : "Review note"}: {it.review_note}
                    </div>
                  ) : null}

                  <textarea
                    value={notes[it.id] || ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [it.id]: e.target.value }))}
                    className="w-full min-h-[80px] rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
                    placeholder={locale === "zh" ? "输入审批内容..." : "Write a review note..."}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    {it.image_url ? (
                      <a
                        href={buildDownloadUrl(it.image_url, it.image_name, it.image_mime_type)}
                        target="_blank"
                        rel="noreferrer"
                        download={it.image_name || undefined}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
                      >
                        {locale === "zh" ? "下载" : "Download"}
                      </a>
                    ) : null}
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
