"use client";

import React from "react";
import sanitizeHtml from "sanitize-html";

import { useSystemRealtimeRefresh } from "@/lib/system/useSystemRealtimeRefresh";
import { dispatchPendingDelta, dispatchSystemRealtime } from "@/lib/system/realtime";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { usePagination } from "@/components/ui/usePagination";

type RecordRow = {
  id: string;
  type: string | null;
  created_at: string | null;
  email: string | null;
  name: string | null;
  payload: Record<string, unknown> | string | null;
  content: string | null;
  read_at?: string | null;
};

function parsePayload(row: RecordRow): Record<string, unknown> {
  if (row.payload && typeof row.payload === "object") return row.payload;
  if (typeof row.payload === "string" && row.payload.trim()) {
    try {
      const parsed = JSON.parse(row.payload) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // ignore and fallback to content parsing
    }
  }
  if (row.content) {
    try {
      const parsed = JSON.parse(row.content) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

function sanitizeHtmlContent(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4",
      "img",
      "a",
      "span",
      "div"
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"]
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noreferrer"
        }
      })
    }
  }).trim();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value.trim() || "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => formatValue(entry)).filter((entry) => entry && entry !== "-");
    return normalized.length ? normalized.join(", ") : "-";
  }
  if (typeof value === "object") {
    const anyVal = value as Record<string, unknown>;
    if (typeof anyVal.e164 === "string" && anyVal.e164) return anyVal.e164;
    if (typeof anyVal.phone === "string" && anyVal.phone) return anyVal.phone;
    try {
      const pretty = JSON.stringify(value, null, 2);
      return pretty && pretty.trim() ? pretty : "-";
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function pickFirstText(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function parseRecordDate(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const sqlUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(raw);
  const normalized = sqlUtc ? `${raw.replace(" ", "T")}Z` : raw;
  const date = new Date(normalized);
  if (!Number.isNaN(date.getTime())) return date;
  if (/^\d{10,13}$/.test(raw)) {
    const asNum = Number(raw);
    const ts = raw.length === 13 ? asNum : asNum * 1000;
    const numericDate = new Date(ts);
    if (!Number.isNaN(numericDate.getTime())) return numericDate;
  }
  return null;
}

function formatTime(value: string | null | undefined, locale: "zh" | "en") {
  const text = String(value || "").trim();
  if (!text) return "-";
  const date = parseRecordDate(text);
  if (!date) return text;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return locale === "zh"
    ? `${yyyy}年${mm}月${dd}号  时间：${hh}:${min}`
    : `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function getTimeText(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const candidates = [obj.iso, obj.value, obj.created_at, obj.submitted_at, obj.time];
    for (const item of candidates) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (typeof item === "number" && Number.isFinite(item)) return String(item);
    }
  }
  return null;
}

type DetailItem = {
  key: string;
  label: string;
  value: string;
  html?: boolean;
};

function buildDetails(
  payload: Record<string, unknown>,
  type: "donate" | "contact" | "enrollment",
  locale: "zh" | "en"
): DetailItem[] {
  const labels: Record<string, string> = {
    name: locale === "zh" ? "姓名" : "Name",
    email: "Email",
    wechat: locale === "zh" ? "微信" : "WeChat",
    phone: locale === "zh" ? "手机号" : "Phone",
    intent: locale === "zh" ? "意向" : "Intent",
    bottleneck: locale === "zh" ? "瓶颈" : "Bottleneck",
    instruments: locale === "zh" ? "交易品种" : "Instruments",
    message: locale === "zh" ? "留言" : "Message",
    price: locale === "zh" ? "捐赠金额" : "Donation",
    amount: locale === "zh" ? "捐赠金额" : "Donation",
    program: locale === "zh" ? "报名项目" : "Program",
    channel: locale === "zh" ? "渠道" : "Channel",
    receivedAt: locale === "zh" ? "提交时间" : "Submitted at"
  };

  const order =
    type === "donate"
      ? ["name", "email", "wechat", "price", "amount", "message", "receivedAt"]
      : type === "contact"
        ? ["name", "email", "wechat", "phone", "intent", "bottleneck", "instruments", "message", "receivedAt"]
        : ["name", "email", "wechat", "phone", "program", "message", "receivedAt"];

  const picked = new Set(order);
  const items = order
    .map((key) => ({ key, value: payload[key] }))
    .filter((item) => item.value !== undefined && item.value !== null && String(item.value).trim() !== "");

  const extra = Object.keys(payload)
    .filter((key) => !picked.has(key) && key !== "raw")
    .map((key) => ({ key, value: payload[key] }))
    .filter((item) => item.value !== undefined && item.value !== null && String(item.value).trim() !== "");

  const timeKeys = new Set(["receivedAt", "createdAt", "submittedAt", "created_at", "submitted_at"]);
  return [...items, ...extra].map((item) => {
    const isHtml = /html$/i.test(item.key);
    const timeText = timeKeys.has(item.key) ? getTimeText(item.value) : null;
    const rawValue = timeText ? formatTime(timeText, locale) : formatValue(item.value);
    const value = isHtml ? sanitizeHtmlContent(String(rawValue)) : String(rawValue);
    return {
      key: item.key,
      label: labels[item.key] || item.key,
      value,
      html: isHtml
    };
  });
}

export function AdminRecordsClient({
  locale,
  type,
  title
}: {
  locale: "zh" | "en";
  type: "donate" | "contact" | "enrollment";
  title: string;
}) {
  const [items, setItems] = React.useState<RecordRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<RecordRow | null>(null);
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);
  const [markingId, setMarkingId] = React.useState<string | null>(null);
  const itemsRef = React.useRef<RecordRow[]>([]);
  const retryTimerRef = React.useRef<number | null>(null);
  const loadSeqRef = React.useRef(0);
  const recentMutationAtRef = React.useRef(0);
  const listCacheKey = React.useMemo(() => `records:list:${type}`, [type]);

  const load = React.useCallback(async (options?: { silent?: boolean; forceFresh?: boolean }) => {
    const silent = Boolean(options?.silent);
    let forceFresh = Boolean(options?.forceFresh);
    if (!forceFresh && Date.now() - recentMutationAtRef.current < 15_000) {
      forceFresh = true;
    }
    const seq = ++loadSeqRef.current;
    const hasItems = itemsRef.current.length > 0;
    let keepLoading = false;
    if (!silent) setLoading(true);
    if (forceFresh || !hasItems) setError(null);
    try {
      const requestUrl = `/api/system/admin/records/list?type=${encodeURIComponent(type)}${forceFresh ? "&fresh=1" : ""}`;
      const result = await fetchSystemJson<{ ok?: boolean; items?: RecordRow[] }>(requestUrl, {
        fresh: forceFresh,
        dedupeKey: listCacheKey,
        dedupeWindowMs: forceFresh ? 0 : 900,
        preferStale: !forceFresh && hasItems,
        revalidateInBackground: !forceFresh && hasItems,
        staleTtlMs: 3 * 60_000,
        allowStaleOnRateLimit: true,
        retries: 2,
        retryBaseMs: 280,
        retryMaxMs: 1400
      });
      if (!result.ok) {
        const code = String(result.errorCode || "").toUpperCase();
        const transient =
          result.status === 429 ||
          result.status === 503 ||
          result.status === 0 ||
          result.rateLimited ||
          code === "RATE_LIMITED" ||
          code === "TOO_MANY_REQUESTS" ||
          code === "DB_BUSY" ||
          code === "SERVICE_UNAVAILABLE" ||
          code === "FETCH_FAILED";
        if (transient) {
          keepLoading = !hasItems;
          if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            void load({ forceFresh: true });
          }, 1200);
          return;
        }
        throw new Error(result.errorCode || "load_failed");
      }
      if (seq !== loadSeqRef.current) return;
      const body = (result.body || {}) as any;
      setItems(Array.isArray(body.items) ? body.items : []);
      setError(null);
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return;
      setError(e?.message || "load_failed");
    } finally {
      if (seq !== loadSeqRef.current) return;
      if (!silent && !keepLoading) setLoading(false);
    }
  }, [listCacheKey, type]);

  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  React.useEffect(() => {
    void load({ forceFresh: true });
    return () => {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [load]);

  useSystemRealtimeRefresh(
    () => {
      void load({ silent: true, forceFresh: true });
    },
    { throttleMs: 3000, globalThrottleMs: 3600, dedupeKey: `records:${type}`, tables: ["records"] }
  );

  const { pageItems, page, pageSize, setPage, setPageSize, pageCount, total } = usePagination(items, {
    deps: [type]
  });

  const activePayload = React.useMemo(() => {
    if (!active) return null;
    const payload = parsePayload(active);
    const name = pickFirstText(payload.name, active.name);
    const email = pickFirstText(payload.email, active.email);
    const message = pickFirstText(payload.message, active.content);
    const receivedAt = pickFirstText(
      payload.receivedAt,
      payload.createdAt,
      payload.submittedAt,
      payload.created_at,
      payload.submitted_at,
      active.created_at
    );
    return {
      ...payload,
      ...(name ? { name } : null),
      ...(email ? { email } : null),
      ...(message ? { message } : null),
      ...(receivedAt ? { receivedAt } : null)
    };
  }, [active]);
  const activeDetails = React.useMemo(
    () => (activePayload ? buildDetails(activePayload, type, locale) : []),
    [activePayload, locale, type]
  );

  const copyValue = React.useCallback(async (key: string, value: string) => {
    const text = value.trim();
    if (!text || text === "-") return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1400);
    } catch {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.focus();
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1400);
      } catch {
        // ignore
      }
    }
  }, []);

  const markRead = React.useCallback(
    async (id: string) => {
      if (!id) return;
      setMarkingId(id);
      const optimisticAt = new Date().toISOString();
      setItems((prev) => prev.map((row) => (row.id === id ? { ...row, read_at: optimisticAt } : row)));
      try {
        const result = await fetchSystemJson<{ ok?: boolean; read_at?: string; error?: string }>(
          "/api/system/admin/records/mark-read",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, type }),
            dedupeKey: `records:mark-read:${type}:${id}`,
            retries: 1,
            retryBaseMs: 260,
            retryMaxMs: 1200
          }
        );
        const json = (result.body || null) as any;
        if (!result.ok || !json?.ok) throw new Error(json?.error || result.errorCode || "mark_failed");
        const persistedAt = typeof json?.read_at === "string" && json.read_at ? json.read_at : optimisticAt;
        setItems((prev) => prev.map((row) => (row.id === id ? { ...row, read_at: persistedAt } : row)));
        recentMutationAtRef.current = Date.now();
        const pendingKey =
          type === "contact" ? "contacts" : type === "donate" ? "donations" : "enrollments";
        dispatchPendingDelta({ [pendingKey]: -1 });
        dispatchSystemRealtime({ table: "records", action: "update" });
        void load({ silent: true, forceFresh: true });
      } catch {
        setItems((prev) => prev.map((row) => (row.id === id ? { ...row, read_at: null } : row)));
        setError(locale === "zh" ? "标记失败，请重试。" : "Mark failed. Please retry.");
      } finally {
        setMarkingId((prev) => (prev === id ? null : prev));
      }
    },
    [load, locale, type]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="text-white/90 font-semibold text-xl">{title}</div>
        <div className="mt-2 text-white/60 text-sm">
          {locale === "zh" ? "仅超管可查看，点击可查看详情。" : "Super admin only. Click to view details."}
        </div>
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">{error}</div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 text-white/85 font-semibold flex items-center gap-2">
          <span>{locale === "zh" ? "列表" : "List"}</span>
          <button
            type="button"
            onClick={() => void load({ forceFresh: true })}
            className="ml-auto px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"
          >
            {locale === "zh" ? "刷新" : "Refresh"}
          </button>
        </div>

        {loading ? <div className="p-6 text-white/60">{locale === "zh" ? "加载中..." : "Loading..."}</div> : null}
        {!loading && !items.length ? (
          <div className="p-6 text-white/60">{locale === "zh" ? "暂无数据" : "No items"}</div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-white/50">
              <tr className="border-b border-white/10">
                <th className="px-6 py-3 text-left !whitespace-nowrap">
                  {locale === "zh" ? "姓名" : "Name"}
                </th>
                <th className="px-6 py-3 text-left">Email</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "时间" : "Time"}</th>
                <th className="px-6 py-3 text-left">{locale === "zh" ? "摘要" : "Summary"}</th>
                <th className="px-6 py-3 text-right">{locale === "zh" ? "操作" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {pageItems.map((row) => {
                const payload = parsePayload(row);
                const donateAmount = formatValue(payload.amount ?? payload.price ?? "-");
                const name = formatValue(payload.name ?? row.name ?? "-");
                const email = formatValue(payload.email ?? row.email ?? "-");
                const wechat = formatValue(payload.wechat ?? "-");
                const intent = formatValue(payload.intent ?? payload.message ?? "-");
                const program = formatValue(payload.program ?? payload.message ?? "-");
                const summary =
                  type === "donate"
                    ? locale === "zh"
                      ? `捐赠金额: ${donateAmount} 元  微信: ${wechat}`
                      : `amount: ${donateAmount} 元  wechat: ${wechat}`
                    : type === "contact"
                      ? intent
                      : program;

                return (
                  <tr key={row.id} className="hover:bg-white/5">
                    <td className="px-6 py-4 text-white/80 !whitespace-nowrap">{name}</td>
                    <td className="px-6 py-4 text-white/70">{email}</td>
                    <td className="px-6 py-4 text-white/60">{formatTime(row.created_at, locale)}</td>
                    <td className="px-6 py-4 text-white/60 max-w-[420px] truncate">{summary}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={Boolean(row.read_at) || markingId === row.id}
                          onClick={() => markRead(row.id)}
                          className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-50"
                        >
                          {row.read_at
                            ? locale === "zh"
                              ? "已阅"
                              : "Read"
                            : markingId === row.id
                              ? locale === "zh"
                                ? "处理中..."
                                : "Processing..."
                              : locale === "zh"
                                ? "标为已阅"
                                : "Mark read"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setActive(row)}
                          className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
                        >
                          {locale === "zh" ? "查看" : "View"}
                        </button>
                      </div>
                    </td>
                  </tr>
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

      {active ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
          <div className="w-full max-w-[900px] max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-[#050a14] p-6">
            <div className="flex items-center gap-2">
              <div className="text-white/90 font-semibold">{locale === "zh" ? "详情" : "Details"}</div>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="ml-auto px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
              >
                {locale === "zh" ? "关闭" : "Close"}
              </button>
            </div>
            <div className="mt-3 text-xs text-white/50">
              id: {active.id} · {formatTime(active.created_at, locale)}
            </div>
            <div className="mt-4 max-h-[65vh] overflow-y-auto pr-1">
              <div className="grid gap-3 md:grid-cols-2">
                {activeDetails.length ? (
                  activeDetails.map((item) => (
                    <div key={item.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs text-white/50">{item.label}</div>
                      {item.html ? (
                        <div
                          className="prose prose-invert mt-2 max-w-none text-sm text-white/85"
                          dangerouslySetInnerHTML={{ __html: item.value }}
                        />
                      ) : (
                        <div className="mt-2 flex items-center gap-2 text-sm text-white/85 whitespace-pre-wrap break-words">
                          <span className="flex-1">{item.value}</span>
                          {["email", "phone", "wechat"].includes(item.key) ? (
                            <button
                              type="button"
                              onClick={() => copyValue(item.key, item.value)}
                              className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
                            >
                              {copiedKey === item.key ? (locale === "zh" ? "已复制" : "Copied") : locale === "zh" ? "复制" : "Copy"}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                    {locale === "zh" ? "暂无详情" : "No detail available."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
