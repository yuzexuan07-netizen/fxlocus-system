"use client";

/* eslint-disable @next/next/no-img-element */

import React from "react";
import { useSearchParams } from "next/navigation";

import { ClientDateTime } from "@/components/system/ClientDateTime";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { dispatchPendingDelta, dispatchSystemRealtime } from "@/lib/system/realtime";
import { PreviewModal } from "@/components/system/PreviewModal";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";
import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";

type UserInfo = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  leader_id?: string | null;
};

type LeaderOption = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type WeeklySummaryAdminItem = {
  id: string;
  user_id: string;
  leader_id: string | null;
  student_name: string;
  summary_text: string;
  review_note?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
  strategy_text?: string | null;
  strategy_url?: string | null;
  strategy_name?: string | null;
  strategy_mime_type?: string | null;
  curve_text?: string | null;
  curve_url?: string | null;
  curve_name?: string | null;
  curve_mime_type?: string | null;
  stats_text?: string | null;
  stats_url?: string | null;
  stats_name?: string | null;
  stats_mime_type?: string | null;
  user?: UserInfo | null;
};

type AssetLabel = {
  zh: string;
  en: string;
};

const STUDENT_ASSET_LABELS: AssetLabel[] = [
  { zh: "\u7b56\u7565", en: "Strategy" },
  { zh: "\u672c\u5468\u66f2\u7ebf", en: "Weekly curve" },
  { zh: "\u7edf\u8ba1", en: "Stats" }
];
const ASSISTANT_ASSET_LABELS: AssetLabel[] = [
  { zh: "\u62db\u8058\u6570\u636e", en: "Recruiting data" },
  { zh: "\u5b66\u5458\u6570\u636e", en: "Student data" },
  { zh: "\u4e91\u7535\u8111\u6570\u636e", en: "Cloud PC data" }
];
const LEADER_ASSET_LABELS: AssetLabel[] = [
  { zh: "\u62db\u8058\u6570\u636e\u603b\u7ed3", en: "Recruiting data summary" },
  { zh: "\u4ea4\u6613\u603b\u7ed3", en: "Trading summary" },
  { zh: "\u9047\u5230\u7684\u95ee\u9898", en: "Issues encountered" }
];
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "heic", "heif", "jfif"]);

function getTitle(locale: "zh" | "en", roleFilter: "student" | "leader" | "assistant") {
  if (roleFilter === "leader") {
    return locale === "zh" ? "\u56e2\u961f\u957f\u5468\u603b\u7ed3\u7ba1\u7406" : "Leader Weekly Summaries";
  }
  if (roleFilter === "assistant") {
    return locale === "zh" ? "\u52a9\u6559\u5468\u603b\u7ed3\u7ba1\u7406" : "Assistant Weekly Summaries";
  }
  return locale === "zh" ? "\u5b66\u5458\u5468\u603b\u7ed3\u7ba1\u7406" : "Student Weekly Summaries";
}

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

function isImageAsset(fileName?: string | null, mimeType?: string | null) {
  const safeMime = String(mimeType || "").trim().toLowerCase();
  if (safeMime.startsWith("image/")) return true;
  const safeName = String(fileName || "").trim().toLowerCase();
  const ext = safeName.includes(".") ? safeName.split(".").pop() || "" : "";
  return IMAGE_EXTENSIONS.has(ext);
}

function labelsForRole(roleFilter: "student" | "leader" | "assistant") {
  if (roleFilter === "assistant") return ASSISTANT_ASSET_LABELS;
  if (roleFilter === "leader") return LEADER_ASSET_LABELS;
  return STUDENT_ASSET_LABELS;
}

function visibleSummary(summaryText: string | null | undefined, fieldTexts: string[]) {
  const summary = String(summaryText || "").trim();
  if (!summary) return "";
  const joinedFields = fieldTexts.map((text) => text.trim()).filter(Boolean).join("\n\n").trim();
  if (joinedFields && summary === joinedFields) return "";
  if (summary === "Attachments submitted.") return "";
  return summary;
}

export function AdminWeeklySummariesClient({
  locale,
  roleFilter
}: {
  locale: "zh" | "en";
  roleFilter: "student" | "leader" | "assistant";
}) {
  const pendingKey =
    roleFilter === "assistant"
      ? "weeklySummariesAssistant"
      : roleFilter === "leader"
        ? "weeklySummariesLeader"
        : "weeklySummariesStudent";
  const searchParams = useSearchParams();
  const coachId = searchParams?.get("coachId") || "";

  const [items, setItems] = React.useState<WeeklySummaryAdminItem[]>([]);
  const [leaders, setLeaders] = React.useState<LeaderOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [leaderId, setLeaderId] = React.useState("");
  const [role, setRole] = React.useState<"leader" | "super_admin" | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{ name: string; url: string; mimeType?: string | null } | null>(
    null
  );
  const [reviewTarget, setReviewTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [reviewDraft, setReviewDraft] = React.useState("");

  const loadAbortRef = React.useRef<AbortController | null>(null);
  const loadSeqRef = React.useRef(0);
  const recentMutationAtRef = React.useRef(0);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; user?: { role?: string | null } }>("/api/system/me", {
          dedupeKey: "admin-weekly-summaries:me",
          dedupeWindowMs: 1200,
          retries: 1
        });
        const body = (result.body || null) as any;
        if (!alive) return;
        const r = body?.ok ? String(body.user?.role || "") : "";
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

  const load = React.useCallback(
    async (inputForce = false) => {
      let force = inputForce;
      if (!force && Date.now() - recentMutationAtRef.current < 15_000) {
        force = true;
      }
      const seq = ++loadSeqRef.current;
      if (!force) {
        const granted = acquireGlobalPollSlot(
          `admin-weekly-summaries:load:${roleFilter}:${coachId}:${leaderId || "__all__"}`,
          8000
        );
        if (!granted) {
          return;
        }
      }

      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      if (!items.length) setLoading(true);
      if (force || !items.length) setError(null);

      try {
        const qs = new URLSearchParams();
        qs.set("role", roleFilter);
        if (coachId && roleFilter === "student") qs.set("coachId", coachId);
        if (leaderId) qs.set("leaderId", leaderId);
        if (force) qs.set("fresh", "1");
        const url = `/api/system/admin/weekly-summaries/list?${qs.toString()}`;
        const result = await fetchSystemJson<{
          ok?: boolean;
          items?: WeeklySummaryAdminItem[];
          leaders?: LeaderOption[];
        }>(url, {
          signal: controller.signal,
          fresh: force,
          dedupeKey: `weekly-summaries:list:${roleFilter}:${coachId}:${leaderId || "__all__"}`,
          dedupeWindowMs: force ? 250 : 1400,
          preferStale: !force,
          revalidateInBackground: !force,
          staleTtlMs: 5 * 60_000,
          allowStaleOnRateLimit: true,
          retries: 2,
          retryBaseMs: 300,
          retryMaxMs: 1800
        });
        if (!result.ok) throw new Error(result.errorCode || "load_failed");
        if (seq !== loadSeqRef.current) return;
        const body = (result.body || {}) as any;
        setItems(Array.isArray(body.items) ? body.items : []);
        setLeaders(Array.isArray(body.leaders) ? body.leaders : []);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        if (seq !== loadSeqRef.current) return;
        setError(e?.message || "load_failed");
      } finally {
        if (seq !== loadSeqRef.current) return;
        if (loadAbortRef.current === controller) {
          loadAbortRef.current = null;
        }
        setLoading(false);
      }
    },
    [coachId, items.length, leaderId, roleFilter]
  );

  React.useEffect(() => {
    load(true);
  }, [load]);

  React.useEffect(() => {
    return () => {
      loadAbortRef.current?.abort();
      loadAbortRef.current = null;
    };
  }, []);

  useSystemRealtimeRefresh(
    () => load(true),
    {
      tables: ["weekly_summaries"],
      throttleMs: 3600,
      globalThrottleMs: 4800,
      dedupeKey: `weekly-summaries:list:${roleFilter}:${coachId}:${leaderId || "__all__"}`
    }
  );

  const markReviewed = async (entryId: string, note?: string) => {
    setBusyId(entryId);
    setError(null);
    try {
      const prevItem = items.find((item) => item.id === entryId) || null;
      const shouldDec = !prevItem?.reviewed_at;
      const result = await fetchSystemJson("/api/system/admin/weekly-summaries/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId, reviewNote: note?.trim() || undefined }),
        retries: 1,
        dedupeWindowMs: 0
      });
      const body = (result.body || null) as any;
      if (!result.ok || !body?.ok) throw new Error(body?.error || result.errorCode || "update_failed");
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((item) =>
          item.id === entryId
            ? {
                ...item,
                reviewed_at: now,
                review_note: note?.trim() || item.review_note
              }
            : item
        )
      );
      recentMutationAtRef.current = Date.now();
      if (shouldDec) dispatchPendingDelta({ [pendingKey]: -1 });
      dispatchSystemRealtime({ table: "weekly_summaries", action: "update" });
      void load(true);
    } catch (e: any) {
      setError(e?.message || "update_failed");
    } finally {
      setBusyId(null);
    }
  };

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => {
      const hay = `${item.student_name || ""} ${item.user?.full_name || ""} ${item.user?.email || ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [items, query]);

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(filtered, {
    pageSize: 10,
    deps: [query, leaderId, coachId]
  });

  const title = getTitle(locale, roleFilter);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-xl font-semibold text-white/90">{title}</div>
        <div className="mt-2 text-sm text-white/60">
          {locale === "zh"
            ? "\u67e5\u770b\u5468\u603b\u7ed3\u5e76\u6807\u8bb0\u5df2\u9605\u3002"
            : "Review weekly summaries and mark as reviewed."}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-white/10 bg-white/5 p-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          placeholder={locale === "zh" ? "\u641c\u7d22\uff1a\u59d3\u540d/\u90ae\u7bb1" : "Search: name/email"}
        />
        {role === "super_admin" && roleFilter !== "leader" ? (
          <select
            value={leaderId}
            onChange={(e) => setLeaderId(e.target.value)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
          >
            <option value="">{locale === "zh" ? "\u5168\u90e8\u56e2\u961f\u957f" : "All leaders"}</option>
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
          {locale === "zh" ? "\u52a0\u8f7d\u4e2d..." : "Loading..."}
        </div>
      ) : null}

      {!loading && !filtered.length ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
          {locale === "zh" ? "\u6682\u65e0\u8bb0\u5f55" : "No submissions."}
        </div>
      ) : null}

      <div className="space-y-4">
        {pageItems.map((item) => {
          const reviewed = Boolean(item.reviewed_at);
          const status = reviewed ? (locale === "zh" ? "\u5df2\u9605" : "Reviewed") : locale === "zh" ? "\u5f85\u9605" : "Pending";
          const statusClass = reviewed ? "text-emerald-300" : "text-amber-200";
          const name = item.user?.full_name || item.student_name || "-";
          const email = item.user?.email || "-";
          const labels = labelsForRole(roleFilter);
          const fieldTexts = [
            String(item.strategy_text || "").trim(),
            String(item.curve_text || "").trim(),
            String(item.stats_text || "").trim()
          ];
          const summaryText = visibleSummary(item.summary_text, fieldTexts);
          const assets = [
            {
              label: locale === "zh" ? labels[0].zh : labels[0].en,
              url: item.strategy_url,
              name: item.strategy_name,
              mimeType: item.strategy_mime_type
            },
            {
              label: locale === "zh" ? labels[1].zh : labels[1].en,
              url: item.curve_url,
              name: item.curve_name,
              mimeType: item.curve_mime_type
            },
            {
              label: locale === "zh" ? labels[2].zh : labels[2].en,
              url: item.stats_url,
              name: item.stats_name,
              mimeType: item.stats_mime_type
            }
          ];

          return (
            <div key={item.id} className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-center gap-3">
                <div className="whitespace-nowrap font-semibold text-white/90">
                  <span className="system-name">{name}</span>
                </div>
                <div className="text-xs text-white/60">{email}</div>
                <div className={`text-xs ${statusClass}`}>{status}</div>
                <div className="ml-auto text-xs text-white/50">
                  <span>{locale === "zh" ? "\u4e0a\u4f20\u65f6\u95f4\uff1a" : "Uploaded: "}</span>
                  <ClientDateTime value={item.created_at} />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {assets.map((asset) => {
                  const canPreview = Boolean(asset.url);
                  const showDownload = canPreview;
                  const showThumb = canPreview && isImageAsset(asset.name, asset.mimeType);
                  const inlineUrl = asset.url ? withQueryParam(asset.url, "disposition", "inline") : "";
                  return (
                    <div key={asset.label} className={showDownload ? "space-y-2" : ""}>
                      <button
                        type="button"
                        disabled={!canPreview}
                        onClick={() =>
                          canPreview &&
                          setPreview({
                            url: asset.url || "",
                            name: asset.name || asset.label,
                            mimeType: asset.mimeType
                          })
                        }
                        className="group relative h-[140px] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                      >
                        {canPreview ? (
                          showThumb ? (
                            <img
                              src={inlineUrl}
                              alt={asset.name || asset.label}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover transition group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-white/70">
                              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                                {locale === "zh" ? "\u70b9\u51fb\u9884\u89c8" : "Preview"}
                              </div>
                              <div className="max-w-[160px] truncate text-white/60">{asset.name || asset.label}</div>
                            </div>
                          )
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-white/50">
                            {locale === "zh" ? "\u672a\u4e0a\u4f20\u6587\u4ef6" : "No file uploaded"}
                          </div>
                        )}
                        <div className="absolute left-2 top-2 rounded-lg bg-black/40 px-2 py-1 text-[11px] text-white/80">
                          {asset.label}
                        </div>
                      </button>
                      {showDownload ? (
                        <a
                          href={asset.url ? buildDownloadUrl(asset.url, asset.name, asset.mimeType) : "#"}
                          target="_blank"
                          rel="noreferrer"
                          download={asset.name || undefined}
                          className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
                        >
                          {locale === "zh" ? "\u4e0b\u8f7d" : "Download"}
                        </a>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                {summaryText ? <div className="whitespace-pre-wrap text-sm text-white/85">{summaryText}</div> : null}
                {item.review_note ? (
                  <div className="text-xs text-white/60">
                    {locale === "zh" ? "\u5ba1\u6838\u5907\u6ce8" : "Review note"}: {item.review_note}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === item.id || reviewed}
                  onClick={() => {
                    setReviewTarget({ id: item.id, name });
                    setReviewDraft("");
                  }}
                  className={[
                    "rounded-xl border px-3 py-1.5 text-xs disabled:opacity-50",
                    reviewed
                      ? "border-white/10 bg-white/5 text-white/40"
                      : "border-sky-400/30 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20"
                  ].join(" ")}
                >
                  {busyId === item.id
                    ? locale === "zh"
                      ? "\u5904\u7406\u4e2d..."
                      : "Processing..."
                    : locale === "zh"
                      ? "\u5ba1\u6838"
                      : "Review"}
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id || reviewed}
                  onClick={() => markReviewed(item.id)}
                  className={[
                    "rounded-xl border px-3 py-1.5 text-xs disabled:opacity-50",
                    reviewed
                      ? "border-white/10 bg-white/5 text-white/40"
                      : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                  ].join(" ")}
                >
                  {busyId === item.id
                    ? locale === "zh"
                      ? "\u5904\u7406\u4e2d..."
                      : "Processing..."
                    : locale === "zh"
                      ? "\u5df2\u9605"
                      : "Mark reviewed"}
                </button>
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

      {reviewTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
          <div className="w-full max-w-[720px] rounded-3xl border border-white/10 bg-[#050a14] p-6">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-semibold text-white/90">
                {locale === "zh" ? "\u5468\u603b\u7ed3\u5ba1\u6279" : "Weekly summary review"}
              </div>
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                className="ml-auto rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-white/80 hover:bg-white/10"
              >
                {locale === "zh" ? "\u5173\u95ed" : "Close"}
              </button>
            </div>
            <div className="mt-2 text-xs text-white/60">{reviewTarget.name}</div>
            <textarea
              value={reviewDraft}
              onChange={(e) => setReviewDraft(e.target.value)}
              className="mt-4 min-h-[140px] w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
              placeholder={locale === "zh" ? "\u586b\u5199\u5ba1\u6838\u610f\u89c1\uff08\u53ef\u9009\uff09" : "Write an approval note (optional)"}
            />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setReviewTarget(null);
                  setReviewDraft("");
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-white/80 hover:bg-white/10"
              >
                {locale === "zh" ? "\u53d6\u6d88" : "Cancel"}
              </button>
              <button
                type="button"
                disabled={busyId === reviewTarget.id}
                onClick={async () => {
                  await markReviewed(reviewTarget.id, reviewDraft);
                  setReviewTarget(null);
                  setReviewDraft("");
                }}
                className="ml-auto rounded-xl border border-emerald-400/30 bg-emerald-400/15 px-3 py-1.5 text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
              >
                {busyId === reviewTarget.id
                  ? locale === "zh"
                    ? "\u63d0\u4ea4\u4e2d..."
                    : "Submitting..."
                  : locale === "zh"
                    ? "\u63d0\u4ea4\u5ba1\u6838"
                    : "Submit review"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PreviewModal
        file={preview ? { name: preview.name, url: preview.url, mimeType: preview.mimeType || undefined } : null}
        locale={locale}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
