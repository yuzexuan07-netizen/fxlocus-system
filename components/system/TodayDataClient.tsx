"use client";

import React from "react";

import { acquireGlobalPollSlot } from "@/lib/system/clientPolling";
import { fetchSystemJson } from "@/lib/system/clientFetch";
import type {
  TodayDataEconomicPatch,
  TodayDataItem,
  TodayDataResultCode,
  TodayDataWeekPayload
} from "@/lib/system/todayData";

const TODAY_DATA_TIME_ZONE = "Asia/Shanghai";
const TODAY_DATA_ALL_DAY = "ALL_DAY";

type TodayDataApiResponse = TodayDataWeekPayload & { ok?: boolean };
type TodayDataDetailsResponse = {
  ok?: boolean;
  data?: Record<string, TodayDataEconomicPatch>;
};

const DETAIL_BATCH_SIZE = 18;
const DETAIL_BATCH_CONCURRENCY = 2;
const TODAY_DATA_CACHE_KEY = "fxlocus_today_data_payload_v2";
const TODAY_DATA_CACHE_TTL_MS = 20 * 60_000;

function formatInTimeZone(
  value: string | number | Date,
  locale: "zh" | "en",
  options: Intl.DateTimeFormatOptions
) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone: TODAY_DATA_TIME_ZONE,
    ...options
  }).format(new Date(value));
}

function formatCurrentTime(nowMs: number, locale: "zh" | "en") {
  return formatInTimeZone(nowMs, locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatWeekRange(start: string, end: string, locale: "zh" | "en") {
  const startText = formatInTimeZone(`${start}T00:00:00+08:00`, locale, {
    month: "2-digit",
    day: "2-digit"
  });
  const endText = formatInTimeZone(`${end}T00:00:00+08:00`, locale, {
    month: "2-digit",
    day: "2-digit"
  });
  return `${startText} - ${endText}`;
}

function formatCountdown(ms: number, locale: "zh" | "en") {
  if (ms <= 0) return locale === "zh" ? "即将公布" : "Soon";

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(locale === "zh" ? `${days}天` : `${days}d`);
  if (hours > 0 || days > 0) parts.push(locale === "zh" ? `${hours}小时` : `${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(locale === "zh" ? `${minutes}分钟` : `${minutes}m`);
  parts.push(locale === "zh" ? `${seconds}秒` : `${seconds}s`);
  return parts.join(" ");
}

function importanceStars(value: number) {
  if (value <= 0) return <span className="text-white/35">--</span>;
  const filled = Math.min(5, Math.max(0, Math.floor(value)));
  const empty = Math.max(0, 5 - filled);
  return (
    <span className="inline-flex items-center text-sm leading-none tracking-[0.08em]">
      <span className="text-amber-200/90">{"\u2605".repeat(filled)}</span>
      {empty > 0 ? <span className="text-white/16">{"\u2605".repeat(empty)}</span> : null}
    </span>
  );
}

function typeLabel(kind: TodayDataItem["kind"], locale: "zh" | "en") {
  if (kind === "economic") return locale === "zh" ? "数据" : "Data";
  if (kind === "event") return locale === "zh" ? "事件" : "Event";
  return locale === "zh" ? "休市" : "Holiday";
}

function resultLabel(code: TodayDataResultCode, locale: "zh" | "en") {
  if (locale === "zh") {
    if (code === "bullish") return "利多";
    if (code === "bearish") return "利空";
    if (code === "minor") return "影响较小";
    if (code === "event") return "事件";
    if (code === "holiday") return "休市";
    return "未公布";
  }
  if (code === "bullish") return "Bullish";
  if (code === "bearish") return "Bearish";
  if (code === "minor") return "Limited";
  if (code === "event") return "Event";
  if (code === "holiday") return "Holiday";
  return "Pending";
}

function resultTone(code: TodayDataResultCode) {
  if (code === "bullish") return "text-emerald-200";
  if (code === "bearish") return "text-rose-200";
  if (code === "minor") return "text-amber-200";
  if (code === "event") return "text-sky-200";
  if (code === "holiday") return "text-orange-200";
  return "text-white/65";
}

function formatTimeCell(item: TodayDataItem, locale: "zh" | "en") {
  if (item.timeLabel === TODAY_DATA_ALL_DAY) return locale === "zh" ? "全天" : "All day";
  if (item.preciseTime) {
    const startsAtMs = Date.parse(item.startsAt);
    if (Number.isFinite(startsAtMs)) {
      return formatInTimeZone(startsAtMs, locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    }
  }
  return item.timeLabel;
}

function formatDateCell(value: string, locale: "zh" | "en") {
  return formatInTimeZone(`${value}T00:00:00+08:00`, locale, {
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
}

function getShanghaiDateKey(value: string | null | undefined) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TODAY_DATA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function displayValue(value: string | null) {
  return value ? value : "--";
}

function isEconomicReleaseDue(item: TodayDataItem, nowMs: number) {
  if (item.kind !== "economic") return false;
  if (!item.preciseTime) return false;
  return Date.parse(item.startsAt) <= nowMs;
}

function findNextUpcomingTimedIndex(items: TodayDataItem[], nowMs: number) {
  return items.findIndex(
    (item) => item.kind !== "holiday" && item.preciseTime && Date.parse(item.startsAt) > nowMs
  );
}

function displayActualValue(item: TodayDataItem, nowMs: number, locale: "zh" | "en") {
  if (item.kind !== "economic") return "--";
  if (item.actual) return item.actual;
  if (isEconomicReleaseDue(item, nowMs)) return locale === "zh" ? "未公布" : "Pending";
  return "--";
}

function countDueEmptyEconomicItems(items: TodayDataItem[], nowMs: number) {
  return items.filter((item) => {
    if (item.kind !== "economic") return false;
    if (!item.preciseTime) return false;
    if (Date.parse(item.startsAt) > nowMs) return false;
    return !item.previous && !item.forecast && !item.actual;
  }).length;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function mergeEconomicDetailPatches(
  payload: TodayDataWeekPayload,
  patches: Record<string, TodayDataEconomicPatch>
): TodayDataWeekPayload {
  if (!Object.keys(patches).length) return payload;

  return {
    ...payload,
    items: payload.items.map((item) => {
      if (item.kind !== "economic") return item;
      const patch = patches[item.sourceId];
      if (!patch) return item;
      const patchDate = patch.startsAt ? getShanghaiDateKey(patch.startsAt) : null;
      if (patchDate && patchDate !== item.date) return item;
      return {
        ...item,
        country: patch.country || item.country,
        title: patch.title || item.title,
        importance: patch.importance || item.importance,
        previous: patch.previous,
        forecast: patch.forecast,
        actual: patch.actual,
        startsAt: patch.startsAt || item.startsAt,
        timeLabel: patch.timeLabel || item.timeLabel,
        preciseTime: patch.startsAt ? patch.preciseTime : item.preciseTime,
        resultCode: patch.resultCode
      };
    })
  };
}

async function hydrateEconomicPayload(
  payload: TodayDataWeekPayload,
  force = false
): Promise<TodayDataWeekPayload> {
  const economicIds = Array.from(
    new Set(
      payload.items
        .filter((item) => item.kind === "economic" && item.sourceId)
        .map((item) => item.sourceId)
    )
  );

  if (!economicIds.length) return payload;

  const patchMap: Record<string, TodayDataEconomicPatch> = {};
  const batches = chunkArray(economicIds, DETAIL_BATCH_SIZE);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= batches.length) return;
      const batch = batches[index];
      const result = await fetchSystemJson<TodayDataDetailsResponse>("/api/system/today-data/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: batch, fresh: force }),
        timeoutMs: force ? 15_000 : 12_000,
        retries: force ? 1 : 0,
        retryBaseMs: 300,
        retryMaxMs: 1_600
      }).catch(() => null);
      const body = result?.body as any;
      if (!result?.ok || !body?.ok || !body?.data || typeof body.data !== "object") continue;
      Object.assign(patchMap, body.data);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(DETAIL_BATCH_CONCURRENCY, batches.length)) }, () => worker())
  );

  return mergeEconomicDetailPatches(payload, patchMap);
}

function readCachedTodayData() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TODAY_DATA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; payload?: TodayDataWeekPayload };
    const cachedAt = Number(parsed?.at || 0);
    const payload = parsed?.payload;
    if (!cachedAt || Date.now() - cachedAt > TODAY_DATA_CACHE_TTL_MS) return null;
    if (!payload || !Array.isArray(payload.items)) return null;
    return payload;
  } catch {
    return null;
  }
}

function writeCachedTodayData(payload: TodayDataWeekPayload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TODAY_DATA_CACHE_KEY,
      JSON.stringify({
        at: Date.now(),
        payload
      })
    );
  } catch {
    // ignore storage failures
  }
}

export function TodayDataClient({ locale }: { locale: "zh" | "en" }) {
  const [payload, setPayload] = React.useState<TodayDataWeekPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [hydratingDetails, setHydratingDetails] = React.useState(false);
  const [error, setError] = React.useState("");
  const [nowMs, setNowMs] = React.useState(0);
  const loadingRef = React.useRef(false);
  const pendingForceRefreshRef = React.useRef(false);
  const lastLoadAtRef = React.useRef(0);
  const rowRefs = React.useRef(new Map<string, HTMLTableRowElement>());
  const tableScrollRef = React.useRef<HTMLDivElement | null>(null);
  const autoScrollDoneRef = React.useRef(false);
  const repairAttemptsRef = React.useRef(0);
  const hydrationSeqRef = React.useRef(0);

  const hydratePayloadInBackground = React.useCallback((basePayload: TodayDataWeekPayload, force: boolean) => {
    const seq = hydrationSeqRef.current + 1;
    hydrationSeqRef.current = seq;
    setHydratingDetails(true);

    void hydrateEconomicPayload(basePayload, force)
      .then((hydratedPayload) => {
        if (hydrationSeqRef.current !== seq) return;
        setPayload((current) => {
          if (!current) return hydratedPayload;
          const sameRange =
            current.generatedAt === basePayload.generatedAt &&
            current.weekStart === basePayload.weekStart &&
            current.weekEnd === basePayload.weekEnd;
          return sameRange ? hydratedPayload : current;
        });
        writeCachedTodayData(hydratedPayload);
      })
      .catch(() => null)
      .finally(() => {
        if (hydrationSeqRef.current === seq) {
          setHydratingDetails(false);
        }
      });
  }, []);

  const load = React.useCallback(async (force = false, withSpinner = false) => {
    const now = Date.now();
    if (!force && now - lastLoadAtRef.current < 12_000) return;
    if (!force && !acquireGlobalPollSlot("system:today-data", 18_000)) return;
    if (loadingRef.current) {
      if (force) pendingForceRefreshRef.current = true;
      return;
    }

    loadingRef.current = true;
    lastLoadAtRef.current = now;
    if (force) setRefreshing(true);
    if (withSpinner) setLoading(true);

    try {
      const requestUrl = force ? "/api/system/today-data?fresh=1" : "/api/system/today-data";
      const result = await fetchSystemJson<TodayDataApiResponse>(requestUrl, {
        fresh: force,
        dedupeKey: "today-data:week",
        dedupeWindowMs: force ? 500 : 2_500,
        staleTtlMs: 5 * 60_000,
        preferStale: !force,
        revalidateInBackground: !force,
        timeoutMs: force ? 9_000 : 7_000,
        retries: force ? 1 : 0,
        retryBaseMs: 260,
        retryMaxMs: 1_400
      });
      const body = (result.body || null) as any;
      if (!result.ok || !body?.ok) {
        throw new Error(body?.error || result.errorCode || "load_failed");
      }
      const basePayload = {
        generatedAt: String(body.generatedAt || ""),
        now: String(body.now || ""),
        timeZone: String(body.timeZone || TODAY_DATA_TIME_ZONE),
        weekStart: String(body.weekStart || ""),
        weekEnd: String(body.weekEnd || ""),
        items: Array.isArray(body.items) ? body.items : []
      };
      setPayload(basePayload);
      writeCachedTodayData(basePayload);
      setError("");
      hydratePayloadInBackground(basePayload, force);
    } catch (loadError: any) {
      setError(String(loadError?.message || "load_failed"));
    } finally {
      loadingRef.current = false;
      if (force) setRefreshing(false);
      if (withSpinner) setLoading(false);
      if (pendingForceRefreshRef.current) {
        pendingForceRefreshRef.current = false;
        void load(true, false);
      }
    }
  }, [hydratePayloadInBackground]);

  React.useEffect(() => {
    const cached = readCachedTodayData();
    if (cached) {
      setPayload(cached);
      setLoading(false);
      void load(false, false);
      return;
    }
    void load(false, true);
  }, [load]);

  React.useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      void load(false, false);
    };

    const pollMs =
      typeof navigator !== "undefined" && (navigator as any).connection?.saveData ? 120_000 : 60_000;
    const timer = window.setInterval(refresh, pollMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const items = React.useMemo(() => payload?.items || [], [payload?.items]);
  const hasLiveTime = nowMs > 0;
  const nextTimedIndex = React.useMemo(
    () => (hasLiveTime ? findNextUpcomingTimedIndex(items, nowMs) : -1),
    [hasLiveTime, items, nowMs]
  );
  const nextItem = nextTimedIndex >= 0 ? items[nextTimedIndex] || null : null;
  const dueEmptyEconomicCount = React.useMemo(
    () => (hasLiveTime ? countDueEmptyEconomicItems(items, nowMs) : 0),
    [hasLiveTime, items, nowMs]
  );
  const focusNowMs = React.useMemo(() => {
    const base = payload?.now || payload?.generatedAt || "";
    const parsed = Date.parse(base);
    return Number.isFinite(parsed) ? parsed : nowMs;
  }, [nowMs, payload?.generatedAt, payload?.now]);
  const initialFocusIndex = React.useMemo(
    () => findNextUpcomingTimedIndex(items, focusNowMs),
    [focusNowMs, items]
  );
  const nextCountdown =
    nextItem && hasLiveTime ? formatCountdown(Date.parse(nextItem.startsAt) - nowMs, locale) : null;

  React.useEffect(() => {
    if (autoScrollDoneRef.current) return;
    if (!items.length) return;
    if (initialFocusIndex < 0) {
      autoScrollDoneRef.current = true;
      return;
    }

    const anchorIndex = Math.max(0, initialFocusIndex - 1);
    const anchorItem = items[anchorIndex];
    if (!anchorItem) return;

    const frameId = window.requestAnimationFrame(() => {
      const container = tableScrollRef.current;
      const row = rowRefs.current.get(anchorItem.id);
      if (!container || !row) return;
      const header = container.querySelector("thead");
      const headerHeight = header instanceof HTMLElement ? header.getBoundingClientRect().height : 0;
      const targetTop = Math.max(0, row.offsetTop - headerHeight - 12);
      container.scrollTo({ top: targetTop, behavior: "smooth" });
      autoScrollDoneRef.current = true;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [initialFocusIndex, items]);

  React.useEffect(() => {
    if (!payload || loading || error || hydratingDetails) return;
    if (dueEmptyEconomicCount <= 0) {
      repairAttemptsRef.current = 0;
      return;
    }
    if (repairAttemptsRef.current >= 2) return;

    repairAttemptsRef.current += 1;
    const timer = window.setTimeout(() => {
      void load(true, false);
    }, repairAttemptsRef.current === 1 ? 900 : 1800);
    return () => window.clearTimeout(timer);
  }, [dueEmptyEconomicCount, error, hydratingDetails, load, loading, payload]);

  const headerDescription =
    locale === "zh"
      ? "仅显示上海时区下今天与明天的重要经济数据、事件与休市安排。"
      : "This view only shows today's and tomorrow's economic releases, events, and holiday closures.";
  const loadErrorLabel = locale === "zh" ? "数据加载失败，请稍后重试。" : "Failed to load economic data.";

  const stickyHeadCellClass = "sticky top-0 z-10 bg-[#241a34]/95 backdrop-blur";

  return (
    <div className="max-w-[1440px] space-y-6">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <div className="text-xl font-semibold text-white/92">
              {locale === "zh" ? "经济数据" : "Economic Data"}
            </div>
            <div className="mt-2 text-sm text-white/58">{headerDescription}</div>
          </div>
          <button
            type="button"
            onClick={() => void load(true, false)}
            disabled={refreshing}
            aria-busy={refreshing}
            className="ml-auto rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/72 transition hover:bg-white/10 disabled:cursor-wait disabled:border-sky-300/30 disabled:bg-sky-300/10 disabled:text-sky-100"
          >
            {refreshing ? <span className="mr-1 inline-block text-sky-100">...</span> : null}
            {locale === "zh" ? "刷新" : "Refresh"}
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-white/42">
              {locale === "zh" ? "现在时间" : "Current Time"}
            </div>
            <div className="mt-3 text-lg font-semibold text-white">
              {hasLiveTime ? formatCurrentTime(nowMs, locale) : "--"}
            </div>
            <div className="mt-2 text-xs text-white/45">{TODAY_DATA_TIME_ZONE}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-white/42">
              {locale === "zh" ? "显示范围" : "Display Range"}
            </div>
            <div className="mt-3 text-lg font-semibold text-white">
              {payload?.weekStart && payload?.weekEnd
                ? formatWeekRange(payload.weekStart, payload.weekEnd, locale)
                : "--"}
            </div>
            <div className="mt-2 text-xs text-white/45">
              {locale === "zh" ? `共 ${items.length} 条` : `${items.length} items`}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-white/42">
              {locale === "zh" ? "离下一条数据" : "Next Release In"}
            </div>
            <div className="mt-3 text-lg font-semibold text-white">
              {nextCountdown || (locale === "zh" ? "当前范围后续暂无定时数据" : "No timed releases left in this range")}
            </div>
            <div className="mt-2 text-xs text-white/45">
              {nextItem
                ? `${formatDateCell(nextItem.date, locale)} ${formatTimeCell(nextItem, locale)} · ${nextItem.country} · ${nextItem.title}`
                : locale === "zh"
                  ? "后续如有未定时事件，请以列表为准。"
                  : "Refer to the list for tentative events."}
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
        {loading ? (
          <div className="p-6 text-sm text-white/60">{locale === "zh" ? "加载中..." : "Loading..."}</div>
        ) : null}

        {!loading && error ? (
          <div className="p-6 text-sm text-rose-200/85">{loadErrorLabel}</div>
        ) : null}

        {!loading && !error && !items.length ? (
          <div className="p-6 text-sm text-white/60">
            {locale === "zh" ? "当前范围暂无可展示的数据。" : "No economic data available in this range."}
          </div>
        ) : null}

        {!loading && !error && items.length ? (
          <div
            ref={tableScrollRef}
            className="max-h-[min(68vh,52rem)] overflow-auto overscroll-contain"
          >
            <table className="min-w-[1248px] w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-[0.16em] text-white/45">
                <tr>
                  <th className={`${stickyHeadCellClass} px-4 py-3 !min-w-[168px] !max-w-none !whitespace-nowrap !overflow-visible !text-clip`}>{locale === "zh" ? "日期" : "Date"}</th>
                  <th className={`${stickyHeadCellClass} px-4 py-3`}>{locale === "zh" ? "时间" : "Time"}</th>
                  <th className={`${stickyHeadCellClass} px-4 py-3 !min-w-[110px] !whitespace-nowrap`}>{locale === "zh" ? "星级" : "Stars"}</th>
                  <th className={`${stickyHeadCellClass} px-4 py-3`}>{locale === "zh" ? "类型" : "Type"}</th>
                  <th className={`${stickyHeadCellClass} px-4 py-3`}>{locale === "zh" ? "国家" : "Country"}</th>
                  <th className={`${stickyHeadCellClass} px-4 py-3`}>{locale === "zh" ? "标题" : "Title"}</th>
                  <th className={`${stickyHeadCellClass} px-4 py-3 !min-w-[84px] !whitespace-nowrap`}>{locale === "zh" ? "结果" : "Result"}</th>
                  <th className={`${stickyHeadCellClass} px-3 py-3 text-[11px] tracking-[0.08em] !min-w-[72px] !whitespace-nowrap`}>{locale === "zh" ? "前值" : "Previous"}</th>
                  <th className={`${stickyHeadCellClass} px-3 py-3 text-[11px] tracking-[0.08em] !min-w-[72px] !whitespace-nowrap`}>{locale === "zh" ? "预测值" : "Forecast"}</th>
                  <th className={`${stickyHeadCellClass} px-3 py-3 text-[11px] tracking-[0.08em] !min-w-[76px] !whitespace-nowrap`}>{locale === "zh" ? "公布值" : "Actual"}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isUpcoming = hasLiveTime && Date.parse(item.startsAt) > nowMs;
                  const isNextUpcoming = nextItem?.id === item.id;
                  return (
                    <tr
                      key={item.id}
                      ref={(node) => {
                        if (node) rowRefs.current.set(item.id, node);
                        else rowRefs.current.delete(item.id);
                      }}
                      className={[
                        "border-t border-white/8 align-top",
                        isNextUpcoming
                          ? "bg-sky-300/[0.12] shadow-[inset_0_0_0_1px_rgba(125,211,252,0.32)]"
                          : isUpcoming
                            ? "bg-sky-400/[0.03]"
                            : "bg-transparent"
                      ].join(" ")}
                    >
                      <td className="px-4 py-4 text-white/65 !min-w-[168px] !max-w-none !whitespace-nowrap !overflow-visible !text-clip">{formatDateCell(item.date, locale)}</td>
                      <td className="px-4 py-4 text-white/80">{formatTimeCell(item, locale)}</td>
                      <td className="px-4 py-4 font-medium text-amber-200/90 !min-w-[110px] !whitespace-nowrap">
                        {importanceStars(item.importance)}
                      </td>
                      <td className="px-4 py-4">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/72">
                          {typeLabel(item.kind, locale)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-white/78">
                        <div className="flex items-center gap-2">
                          {item.flagUrl ? (
                            <img src={item.flagUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
                          ) : null}
                          <span>{item.country}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-white/90">
                        <div>{item.title}</div>
                        {item.note ? <div className="mt-1 text-xs leading-5 text-white/45">{item.note}</div> : null}
                      </td>
                      <td className={`px-4 py-4 font-medium !min-w-[84px] !whitespace-nowrap ${resultTone(item.resultCode)}`}>
                        {resultLabel(item.resultCode, locale)}
                      </td>
                      <td className="px-3 py-4 text-white/65 !min-w-[72px] !whitespace-nowrap">{displayValue(item.previous)}</td>
                      <td className="px-3 py-4 text-white/65 !min-w-[72px] !whitespace-nowrap">{displayValue(item.forecast)}</td>
                      <td className="px-3 py-4 text-white/88 !min-w-[76px] !whitespace-nowrap">{displayActualValue(item, nowMs, locale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
