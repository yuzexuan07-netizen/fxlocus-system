import { dbFirst, dbRun } from "@/lib/d1";

const JIN10_BASE_URL = "https://e0430d16720e4211b5e072c26205c890.z3c.jin10.com";
const JIN10_HEADERS = {
  "user-agent": "Mozilla/5.0",
  "x-app-id": "sKKYe29sFuJaeOCJ",
  "x-version": "2.0",
  accept: "application/json"
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_TTL_MS = 2 * 60_000;
const STALE_TTL_MS = 30 * 60_000;
const PERSISTENT_FRESH_TTL_MS = 5 * 60_000;
const PERSISTENT_STALE_TTL_MS = 30 * 60 * 60_000;
const DETAIL_FRESH_TTL_MS = 30 * 60_000;
const DETAIL_STALE_TTL_MS = 6 * 60 * 60_000;
const DETAIL_PENDING_FRESH_TTL_MS = 30_000;
const DETAIL_PENDING_STALE_TTL_MS = 15 * 60_000;
const ECONOMIC_DETAIL_CONCURRENCY = 12;
const ECONOMIC_DETAIL_RETRY_CONCURRENCY = 6;
const JIN10_DAY_TIMEOUT_MS = 6_500;
const JIN10_EVENT_TIMEOUT_MS = 5_500;
const JIN10_HOLIDAY_TIMEOUT_MS = 5_500;
const JIN10_DETAIL_TIMEOUT_MS = 4_500;
const JIN10_WEEK_TIMEOUT_MS = 6_500;
const TODAY_DATA_CACHE_SCHEMA_VERSION = "v2";

export const TODAY_DATA_TIME_ZONE = "Asia/Shanghai";
export const TODAY_DATA_ALL_DAY = "ALL_DAY";

export type TodayDataKind = "economic" | "event" | "holiday";
export type TodayDataResultCode = "pending" | "minor" | "bullish" | "bearish" | "event" | "holiday";

export type TodayDataItem = {
  id: string;
  sourceId: string;
  kind: TodayDataKind;
  date: string;
  startsAt: string;
  preciseTime: boolean;
  timeLabel: string;
  country: string;
  title: string;
  importance: number;
  previous: string | null;
  forecast: string | null;
  actual: string | null;
  resultCode: TodayDataResultCode;
  note: string | null;
  flagUrl: string | null;
};

export type TodayDataWeekPayload = {
  generatedAt: string;
  now: string;
  timeZone: string;
  weekStart: string;
  weekEnd: string;
  items: TodayDataItem[];
};

export type TodayDataEconomicPatch = {
  sourceId: string;
  country: string | null;
  title: string | null;
  importance: number;
  previous: string | null;
  forecast: string | null;
  actual: string | null;
  startsAt: string | null;
  timeLabel: string | null;
  preciseTime: boolean;
  resultCode: TodayDataResultCode;
};

type Jin10Envelope<T> = {
  status?: number;
  message?: string;
  data?: T;
};

type Jin10EconomicRaw = {
  data_id?: number | string | null;
  id?: number | string | null;
  indicator_name?: string | null;
  name?: string | null;
  country?: string | null;
  date?: string | null;
  day?: string | null;
  time_period?: string | null;
  star?: number | string | null;
  previous?: string | number | null;
  consensus?: string | number | null;
  actual?: string | number | null;
  affect?: number | string | null;
  show?: number | string | null;
  pub_time?: string | null;
  actual_time?: string | null;
  public_time?: string | null;
  time_status?: string | null;
  time_show?: string | null;
  unit?: string | null;
  flag_url?: string | null;
};

type Jin10EconomicDetailRaw = {
  id?: number | string | null;
  dataId?: number | string | null;
  title?: string | null;
  name?: string | null;
  country?: string | null;
  time_period?: string | null;
  star?: number | string | null;
  previous?: string | number | null;
  consensus?: string | number | null;
  actual?: string | number | null;
  affect?: number | string | null;
  public_time?: string | null;
  time_show?: string | null;
  unit?: string | null;
};

type Jin10EventRaw = {
  id?: number | string | null;
  data_id?: number | string | null;
  date?: string | null;
  day?: string | null;
  event_time?: string | null;
  event_time_unix?: number | string | null;
  country?: string | null;
  star?: number | string | null;
  event_content?: string | null;
  time_status?: string | null;
  note?: string | null;
  flag_url?: string | null;
};

type Jin10HolidayPageRaw = {
  id?: number | string | null;
  date?: string | null;
  date_unix?: number | string | null;
  country?: string | null;
  exchange_name?: string | null;
  name?: string | null;
  rest_note?: string | null;
  remark?: string | null;
  flag_url?: string | null;
};

type CacheEntry = {
  freshUntil: number;
  staleUntil: number;
  value: TodayDataWeekPayload;
};

type PersistentTodayDataCacheRow = {
  value_json: string | null;
  fresh_until_ms: number | null;
  stale_until_ms: number | null;
};

type EconomicDetailCacheEntry = {
  freshUntil: number;
  staleUntil: number;
  value: Jin10EconomicDetailRaw | null;
};

const g = globalThis as {
  __fx_today_data_cache?: Map<string, CacheEntry>;
  __fx_today_data_inflight?: Map<string, Promise<TodayDataWeekPayload>>;
  __fx_today_data_detail_cache?: Map<string, EconomicDetailCacheEntry>;
  __fx_today_data_detail_inflight?: Map<string, Promise<Jin10EconomicDetailRaw | null>>;
};

if (!g.__fx_today_data_cache) g.__fx_today_data_cache = new Map();
if (!g.__fx_today_data_inflight) g.__fx_today_data_inflight = new Map();
if (!g.__fx_today_data_detail_cache) g.__fx_today_data_detail_cache = new Map();
if (!g.__fx_today_data_detail_inflight) g.__fx_today_data_detail_inflight = new Map();

const weeklyCache = g.__fx_today_data_cache;
const weeklyInflight = g.__fx_today_data_inflight;
const economicDetailCache = g.__fx_today_data_detail_cache;
const economicDetailInflight = g.__fx_today_data_detail_inflight;

function getTimeZoneDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value || "0"),
    month: Number(parts.find((part) => part.type === "month")?.value || "0"),
    day: Number(parts.find((part) => part.type === "day")?.value || "0")
  };
}

function formatUtcDateIndex(dayIndex: number) {
  const date = new Date(dayIndex * DAY_MS);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekRange(date: Date = new Date(), timeZone: string = TODAY_DATA_TIME_ZONE) {
  const { year, month, day } = getTimeZoneDateParts(date, timeZone);
  const currentDayIndex = Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
  const mondayIndex = currentDayIndex - (weekday - 1);
  const sundayIndex = mondayIndex + 6;
  const days = Array.from({ length: 7 }, (_, index) => formatUtcDateIndex(mondayIndex + index));
  return {
    weekKey: formatUtcDateIndex(mondayIndex),
    weekStart: formatUtcDateIndex(mondayIndex),
    weekEnd: formatUtcDateIndex(sundayIndex),
    days
  };
}

function getVisibleRangeDays(date: Date, timeZone: string = TODAY_DATA_TIME_ZONE) {
  const { year, month, day } = getTimeZoneDateParts(date, timeZone);
  const currentDayIndex = Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
  return [formatUtcDateIndex(currentDayIndex), formatUtcDateIndex(currentDayIndex + 1)];
}

function getWeekBoundsForDateKey(dateString: string) {
  const [year, month, day] = dateString.split("-").map((value) => Number(value));
  const currentDayIndex = Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
  const mondayIndex = currentDayIndex - (weekday - 1);
  const sundayIndex = mondayIndex + 6;
  return {
    weekStart: formatUtcDateIndex(mondayIndex),
    weekEnd: formatUtcDateIndex(sundayIndex)
  };
}

function getIsoWeekParts(dateString: string) {
  const [year, month, day] = dateString.split("-").map((value) => Number(value));
  const monday = new Date(Date.UTC(year, month - 1, day));
  const weekday = monday.getUTCDay() || 7;
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + (4 - weekday));

  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstWeekday = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + (4 - firstWeekday));

  const isoWeek = Math.floor((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS)) + 1;
  return { isoYear, isoWeek };
}

function parseNumeric(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number.parseFloat(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeString(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function toStringValue(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function parseShanghaiDateTime(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const datetime = raw.match(/^(\d{4}-\d{2}-\d{2})[ ](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (datetime) {
    const seconds = datetime[3] ? `:${datetime[3]}` : ":00";
    return new Date(`${datetime[1]}T${datetime[2]}${seconds}+08:00`);
  }

  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) {
    return new Date(`${dateOnly[1]}T00:00:00+08:00`);
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function formatDateKey(date: Date | null, timeZone: string = TODAY_DATA_TIME_ZONE) {
  if (!date || Number.isNaN(date.getTime())) return null;
  const { year, month, day } = getTimeZoneDateParts(date, timeZone);
  if (!year || !month || !day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatTimeLabel(date: Date | null, fallback: string | null, allDay = false) {
  if (allDay) return TODAY_DATA_ALL_DAY;
  const fallbackText = String(fallback || "").trim();
  if (fallbackText) return fallbackText;
  if (!date || Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TODAY_DATA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function normalizeImportance(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const normalized = Math.floor(numeric);
  if (normalized <= 0) return 0;
  return Math.min(5, normalized);
}

function buildEconomicTitle(
  country: string | null,
  timePeriod: string | null,
  name: string | null,
  unit: string | null
) {
  const title = `${country || ""}${timePeriod || ""}${name || ""}`.trim();
  if (!title) return null;
  if (!unit || unit === "%") return title;
  return `${title}(${unit})`;
}

function computeEconomicResultCode(raw: Jin10EconomicRaw): TodayDataResultCode {
  const actualText = normalizeString(raw.actual);
  if (!actualText) return "pending";

  const actual = parseNumeric(raw.actual);
  const forecast = raw.consensus === null || raw.consensus === undefined ? null : raw.consensus;
  const baselineSource = forecast !== null ? forecast : raw.previous;
  const baseline = parseNumeric(baselineSource);
  const affect = Number(raw.affect);

  if (baseline === null || actual === null || actual === baseline) return "minor";
  if (affect === 0) return actual > baseline ? "bullish" : "bearish";
  return actual > baseline ? "bearish" : "bullish";
}

function buildEconomicPatch(sourceId: string, detail: Jin10EconomicDetailRaw): TodayDataEconomicPatch {
  const country = normalizeString(detail.country);
  const title =
    normalizeString(detail.title) ||
    buildEconomicTitle(
      country,
      normalizeString(detail.time_period),
      normalizeString(detail.name),
      normalizeString(detail.unit)
    );
  const startsAtDate = parseShanghaiDateTime(detail.public_time);
  const previous = toStringValue(detail.previous);
  const forecast = toStringValue(detail.consensus);
  const actual = toStringValue(detail.actual);

  return {
    sourceId,
    country,
    title,
    importance: normalizeImportance(detail.star),
    previous,
    forecast,
    actual,
    startsAt: startsAtDate ? startsAtDate.toISOString() : null,
    timeLabel: normalizeString(detail.time_show),
    preciseTime: true,
    resultCode: computeEconomicResultCode({
      affect: detail.affect,
      previous,
      consensus: forecast,
      actual
    })
  };
}

async function fetchJin10Json<T>(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timerId = setTimeout(() => {
    controller.abort(new Error("UPSTREAM_TIMEOUT"));
  }, Math.max(500, timeoutMs));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: JIN10_HEADERS,
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("UPSTREAM_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timerId);
  }

  if (!response.ok) {
    throw new Error(`UPSTREAM_${response.status}`);
  }

  return (await response.json()) as T;
}

async function fetchDayEconomics(date: string) {
  const payload = await fetchJin10Json<Jin10Envelope<Jin10EconomicRaw[]>>(
    `${JIN10_BASE_URL}/get/data?date=${encodeURIComponent(date)}&category=cj`,
    JIN10_DAY_TIMEOUT_MS
  );
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function fetchEconomicDetail(sourceId: string, options: { fresh?: boolean } = {}) {
  const now = Date.now();
  const cached = economicDetailCache.get(sourceId);
  if (!options.fresh && cached && cached.freshUntil > now) return cached.value;

  const pending = economicDetailInflight.get(sourceId);
  if (!options.fresh && pending) return pending;

  const task = (async () => {
    try {
      const payload = await fetchJin10Json<Jin10Envelope<Jin10EconomicDetailRaw>>(
        `${JIN10_BASE_URL}/web/data/jiedu?id=${encodeURIComponent(sourceId)}`,
        JIN10_DETAIL_TIMEOUT_MS
      );
      const value = payload?.data || null;
      const hasActual = Boolean(normalizeString(value?.actual));
      const freshTtl = hasActual ? DETAIL_FRESH_TTL_MS : DETAIL_PENDING_FRESH_TTL_MS;
      const staleTtl = hasActual ? DETAIL_STALE_TTL_MS : DETAIL_PENDING_STALE_TTL_MS;
      economicDetailCache.set(sourceId, {
        freshUntil: Date.now() + freshTtl,
        staleUntil: Date.now() + staleTtl,
        value
      });
      return value;
    } catch (error) {
      const stale = economicDetailCache.get(sourceId);
      if (!options.fresh && stale && stale.staleUntil > Date.now()) return stale.value;
      return null;
    }
  })();

  economicDetailInflight.set(sourceId, task);
  try {
    return await task;
  } finally {
    economicDetailInflight.delete(sourceId);
  }
}

async function fetchWeekJson<T>(weekStart: string, filename: string) {
  const { isoYear, isoWeek } = getIsoWeekParts(weekStart);
  return fetchJin10Json<T>(
    `https://cdn-rili.jin10.com/web_data/${isoYear}/week/${isoWeek}/${filename}`,
    JIN10_WEEK_TIMEOUT_MS
  );
}

async function fetchDayEvents(date: string) {
  const payload = await fetchJin10Json<Jin10Envelope<Jin10EventRaw[]>>(
    `${JIN10_BASE_URL}/get/event?date=${encodeURIComponent(date)}&category=cj`,
    JIN10_EVENT_TIMEOUT_MS
  );
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function fetchWeekHolidayPage(date: string) {
  const payload = await fetchJin10Json<Jin10Envelope<{ data?: Jin10HolidayPageRaw[] } | Jin10HolidayPageRaw[]>>(
    `${JIN10_BASE_URL}/page/holiday?date=${encodeURIComponent(date)}&category=cj`,
    JIN10_HOLIDAY_TIMEOUT_MS
  );

  const outer = payload?.data;
  if (Array.isArray(outer)) return outer;
  if (Array.isArray((outer as any)?.data)) return (outer as any).data as Jin10HolidayPageRaw[];
  return [];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function getEconomicStartsAtDate(row: Jin10EconomicRaw, detail?: Jin10EconomicDetailRaw | null) {
  return (
    parseShanghaiDateTime(detail?.public_time) ||
    parseShanghaiDateTime(row.public_time) ||
    parseShanghaiDateTime(row.actual_time || row.pub_time)
  );
}

function isEconomicDetailForDate(detail: Jin10EconomicDetailRaw | null | undefined, date: string) {
  if (!detail?.public_time) return true;
  const detailDate = formatDateKey(parseShanghaiDateTime(detail.public_time));
  return !detailDate || detailDate === date;
}

function hasEconomicValues(row: Jin10EconomicRaw, detail?: Jin10EconomicDetailRaw | null) {
  return Boolean(
    normalizeString(detail?.previous ?? row.previous) ||
      normalizeString(detail?.consensus ?? row.consensus) ||
      normalizeString(detail?.actual ?? row.actual)
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickDateOnly(value: unknown) {
  const text = normalizeString(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

type DatedRow<T> = {
  date: string;
  row: T;
};

function collectWeeklyRows<T extends Record<string, unknown>>(
  input: unknown,
  isCandidate: (value: Record<string, unknown>) => value is T,
  resolveDate: (row: T, inheritedDate: string | null) => string | null,
  inheritedDate: string | null = null,
  depth = 0
): DatedRow<T>[] {
  if (depth > 10 || input === null || input === undefined) return [];
  if (Array.isArray(input)) {
    return input.flatMap((value) => collectWeeklyRows(value, isCandidate, resolveDate, inheritedDate, depth + 1));
  }
  if (!isObjectRecord(input)) return [];

  const nextInheritedDate = pickDateOnly(input.date) || pickDateOnly(input.day) || inheritedDate;
  if (isCandidate(input)) {
    const date = resolveDate(input, nextInheritedDate);
    return date ? [{ date, row: input }] : [];
  }

  return Object.values(input).flatMap((value) =>
    collectWeeklyRows(value, isCandidate, resolveDate, nextInheritedDate, depth + 1)
  );
}

function normalizeWeeklyEconomicRow(row: Jin10EconomicRaw): Jin10EconomicRaw {
  return {
    ...row,
    data_id: row.data_id ?? row.id
  };
}

function normalizeWeeklyEventRow(row: Jin10EventRaw): Jin10EventRaw {
  return {
    ...row,
    id: row.id ?? row.data_id
  };
}

function isEconomicWeekRow(value: Record<string, unknown>): value is Jin10EconomicRaw {
  return Boolean(
    (value.data_id !== undefined || value.id !== undefined) &&
      (value.indicator_name !== undefined || value.name !== undefined) &&
      value.country !== undefined
  );
}

function isEventWeekRow(value: Record<string, unknown>): value is Jin10EventRaw {
  return Boolean((value.id !== undefined || value.data_id !== undefined) && value.event_content !== undefined && value.country !== undefined);
}

function isHolidayWeekRow(value: Record<string, unknown>): value is Jin10HolidayPageRaw {
  return Boolean(value.id !== undefined && value.country !== undefined && (value.exchange_name !== undefined || value.name !== undefined));
}

function resolveEconomicWeekRowDate(row: Jin10EconomicRaw, inheritedDate: string | null) {
  return (
    pickDateOnly(row.date) ||
    pickDateOnly(row.day) ||
    formatDateKey(parseShanghaiDateTime(row.public_time || row.actual_time || row.pub_time)) ||
    inheritedDate
  );
}

function resolveEventWeekRowDate(row: Jin10EventRaw, inheritedDate: string | null) {
  return (
    pickDateOnly(row.date) ||
    pickDateOnly(row.day) ||
    formatDateKey(parseShanghaiDateTime(row.event_time)) ||
    (row.event_time_unix ? formatDateKey(new Date(Number(row.event_time_unix) * 1000)) : null) ||
    inheritedDate
  );
}

function resolveHolidayWeekRowDate(row: Jin10HolidayPageRaw, inheritedDate: string | null) {
  return pickDateOnly(row.date) || (row.date_unix ? formatDateKey(new Date(Number(row.date_unix) * 1000)) : null) || inheritedDate;
}

function filterWeekEntries<T>(entries: DatedRow<T>[], weekStart: string, weekEnd: string) {
  return entries.filter((entry) => entry.date >= weekStart && entry.date <= weekEnd);
}

async function fetchWeekEconomics(weekStart: string, weekEnd: string) {
  const payload = await fetchWeekJson<unknown>(weekStart, "economics.json");
  return filterWeekEntries(
    collectWeeklyRows(payload, isEconomicWeekRow, resolveEconomicWeekRowDate).map((entry) => ({
      date: entry.date,
      row: normalizeWeeklyEconomicRow(entry.row)
    })),
    weekStart,
    weekEnd
  );
}

async function fetchWeekEvents(weekStart: string, weekEnd: string) {
  const payload = await fetchWeekJson<unknown>(weekStart, "event.json");
  return filterWeekEntries(
    collectWeeklyRows(payload, isEventWeekRow, resolveEventWeekRowDate).map((entry) => ({
      date: entry.date,
      row: normalizeWeeklyEventRow(entry.row)
    })),
    weekStart,
    weekEnd
  );
}

async function fetchWeekHolidays(weekStart: string, weekEnd: string) {
  const payload = await fetchWeekJson<unknown>(weekStart, "holiday.json");
  return filterWeekEntries(collectWeeklyRows(payload, isHolidayWeekRow, resolveHolidayWeekRowDate), weekStart, weekEnd).map(
    (entry) => entry.row
  );
}

function groupWeekRowsByDay<T>(entries: DatedRow<T>[], days: string[]) {
  const buckets = new Map<string, T[]>();
  for (const day of days) buckets.set(day, []);
  for (const entry of entries) {
    if (!buckets.has(entry.date)) continue;
    buckets.get(entry.date)!.push(entry.row);
  }
  return days.map((day) => buckets.get(day) || []);
}

function shouldBackfillEconomicDetail(
  row: Jin10EconomicRaw,
  detail: Jin10EconomicDetailRaw | null | undefined,
  referenceMs: number
) {
  const startsAtDate = getEconomicStartsAtDate(row, detail);
  if (!startsAtDate) return false;
  if (startsAtDate.getTime() > referenceMs) return false;
  return !hasEconomicValues(row, detail);
}

async function fetchEconomicDetailMap(
  rows: Jin10EconomicRaw[],
  options: { fresh?: boolean; referenceDate?: Date; network?: boolean } = {}
) {
  const referenceMs = options.referenceDate?.getTime() ?? Date.now();
  const allowNetwork = options.network !== false;
  const sourceIds = Array.from(
    new Set(
      rows
        .map((row) => {
          const sourceId = normalizeString(row.data_id);
          if (!sourceId) return null;
          return shouldBackfillEconomicDetail(row, null, referenceMs) ? sourceId : null;
        })
        .filter((value): value is string => Boolean(value))
    )
  );

  if (!sourceIds.length) return new Map<string, Jin10EconomicDetailRaw>();

  const readDetail = async (sourceId: string, forceFresh = false) => {
    if (!allowNetwork) {
      const cached = economicDetailCache.get(sourceId);
      if (!cached || cached.staleUntil <= Date.now()) return null;
      return cached.value;
    }
    const detailOptions = forceFresh ? { fresh: true } : options;
    const detail = await fetchEconomicDetail(sourceId, detailOptions);
    return detail;
  };

  const entries = await mapWithConcurrency(sourceIds, ECONOMIC_DETAIL_CONCURRENCY, async (sourceId) => {
    const detail = await readDetail(sourceId);
    return [sourceId, detail] as const;
  });

  const detailById = new Map(
    entries.filter((entry): entry is readonly [string, Jin10EconomicDetailRaw] => Boolean(entry[1]))
  );

  const retryIds = Array.from(
    new Set(
      rows
        .map((row) => {
          const sourceId = normalizeString(row.data_id);
          if (!sourceId) return null;
          return shouldBackfillEconomicDetail(row, detailById.get(sourceId), referenceMs) ? sourceId : null;
        })
        .filter((value): value is string => Boolean(value))
    )
  );

  if (!allowNetwork || !retryIds.length) return detailById;

  const retryEntries = await mapWithConcurrency(
    retryIds,
    Math.max(1, Math.min(ECONOMIC_DETAIL_RETRY_CONCURRENCY, retryIds.length)),
    async (sourceId) => {
      const detail = await readDetail(sourceId, true);
      return [sourceId, detail] as const;
    }
  );

  for (const [sourceId, detail] of retryEntries) {
    if (detail) detailById.set(sourceId, detail);
  }

  return detailById;
}

export async function getEconomicDetailPatches(
  sourceIds: string[],
  options: { fresh?: boolean } = {}
) {
  const uniqueIds = Array.from(
    new Set(
      sourceIds
        .map((sourceId) => normalizeString(sourceId))
        .filter((value): value is string => Boolean(value))
    )
  );

  if (!uniqueIds.length) return new Map<string, TodayDataEconomicPatch>();

  const entries = await mapWithConcurrency(
    uniqueIds,
    Math.max(1, Math.min(ECONOMIC_DETAIL_CONCURRENCY, uniqueIds.length)),
    async (sourceId) => {
      const detail = await fetchEconomicDetail(sourceId, options);
      return [sourceId, detail] as const;
    }
  );

  const patchMap = new Map<string, TodayDataEconomicPatch>();
  for (const [sourceId, detail] of entries) {
    if (!detail) continue;
    patchMap.set(sourceId, buildEconomicPatch(sourceId, detail));
  }
  return patchMap;
}

function fulfilledOrEmpty<T>(result: PromiseSettledResult<T>) {
  return result.status === "fulfilled" ? result.value : [];
}

function normalizeEconomicRows(
  rows: Jin10EconomicRaw[],
  date: string,
  detailById: Map<string, Jin10EconomicDetailRaw>
) {
  return rows
    .filter((row) => normalizeImportance(row.star) > 0)
    .map<TodayDataItem | null>((row) => {
      const sourceId = normalizeString(row.data_id);
      const rawDetail = sourceId ? detailById.get(sourceId) : null;
      const detail = isEconomicDetailForDate(rawDetail, date) ? rawDetail : null;
      const country = normalizeString(detail?.country) || normalizeString(row.country);
      const title = buildEconomicTitle(
        country,
        normalizeString(detail?.time_period) || normalizeString(row.time_period),
        normalizeString(detail?.name) || normalizeString(row.indicator_name) || normalizeString(row.name),
        normalizeString(detail?.unit) || normalizeString(row.unit)
      );
      const startsAtDate =
        parseShanghaiDateTime(detail?.public_time) ||
        parseShanghaiDateTime(row.public_time) ||
        parseShanghaiDateTime(row.actual_time || row.pub_time);
      if (!sourceId || !title || !country || !startsAtDate) return null;

      const previous = toStringValue(detail?.previous ?? row.previous);
      const forecast = toStringValue(detail?.consensus ?? row.consensus);
      const actual = toStringValue(detail?.actual ?? row.actual);
      const preciseTime = !(normalizeString(row.time_status) || normalizeString(row.time_show));
      const startsAt = startsAtDate.toISOString();
      return {
        id: `economic:${sourceId}`,
        sourceId,
        kind: "economic",
        date,
        startsAt,
        preciseTime,
        timeLabel: formatTimeLabel(
          startsAtDate,
          normalizeString(row.time_status) || normalizeString(row.time_show) || normalizeString(detail?.time_show)
        ),
        country,
        title,
        importance: normalizeImportance(detail?.star ?? row.star),
        previous,
        forecast,
        actual,
        resultCode: computeEconomicResultCode({
          ...row,
          affect: detail?.affect ?? row.affect,
          previous,
          consensus: forecast,
          actual
        }),
        note: null,
        flagUrl: normalizeString(row.flag_url)
      };
    })
    .filter((item): item is TodayDataItem => Boolean(item))
    .sort((a, b) => {
      const timeDiff = Date.parse(a.startsAt) - Date.parse(b.startsAt);
      if (timeDiff !== 0) return timeDiff;
      if (a.preciseTime !== b.preciseTime) return a.preciseTime ? -1 : 1;
      if (a.importance !== b.importance) return b.importance - a.importance;
      return a.title.localeCompare(b.title, "zh-CN");
    });
}

function normalizeEventRows(rows: Jin10EventRaw[], date: string) {
  return rows
    .filter((row) => normalizeImportance(row.star) > 0)
    .map<TodayDataItem | null>((row) => {
      const sourceId = normalizeString(row.id);
      const title = normalizeString(row.event_content);
      const country = normalizeString(row.country);
      const startsAtDate =
        parseShanghaiDateTime(row.event_time) ||
        (row.event_time_unix ? new Date(Number(row.event_time_unix) * 1000) : null);
      if (!sourceId || !title || !country || !startsAtDate) return null;

      const preciseTime = !normalizeString(row.time_status);
      const startsAt = startsAtDate.toISOString();
      return {
        id: `event:${sourceId}`,
        sourceId,
        kind: "event",
        date,
        startsAt,
        preciseTime,
        timeLabel: formatTimeLabel(startsAtDate, normalizeString(row.time_status)),
        country,
        title,
        importance: normalizeImportance(row.star),
        previous: null,
        forecast: null,
        actual: null,
        resultCode: "event",
        note: normalizeString(row.note),
        flagUrl: normalizeString(row.flag_url)
      };
    })
    .filter((item): item is TodayDataItem => Boolean(item))
    .sort((a, b) => {
      const timeDiff = Date.parse(a.startsAt) - Date.parse(b.startsAt);
      if (timeDiff !== 0) return timeDiff;
      if (a.preciseTime !== b.preciseTime) return a.preciseTime ? -1 : 1;
      if (a.importance !== b.importance) return b.importance - a.importance;
      return a.title.localeCompare(b.title, "zh-CN");
    });
}

function normalizeHolidayRows(rows: Jin10HolidayPageRaw[], weekStart: string, weekEnd: string) {
  return rows
    .filter((row) => {
      const date = normalizeString(row.date);
      return Boolean(date && date >= weekStart && date <= weekEnd);
    })
    .map<TodayDataItem | null>((row) => {
      const sourceId = normalizeString(row.id);
      const date = normalizeString(row.date);
      const country = normalizeString(row.country);
      const exchangeName = normalizeString(row.exchange_name);
      const holidayName = normalizeString(row.name);
      const startsAtDate =
        parseShanghaiDateTime(date) ||
        (row.date_unix ? new Date(Number(row.date_unix) * 1000) : null);
      if (!sourceId || !date || !country || !holidayName || !startsAtDate) return null;

      return {
        id: `holiday:${sourceId}`,
        sourceId,
        kind: "holiday",
        date,
        startsAt: startsAtDate.toISOString(),
        preciseTime: false,
        timeLabel: formatTimeLabel(startsAtDate, null, true),
        country,
        title: exchangeName ? `${exchangeName} - ${holidayName}` : holidayName,
        importance: 0,
        previous: null,
        forecast: null,
        actual: null,
        resultCode: "holiday",
        note: normalizeString(row.rest_note) || normalizeString(row.remark),
        flagUrl: normalizeString(row.flag_url)
      };
    })
    .filter((item): item is TodayDataItem => Boolean(item))
    .sort((a, b) => {
      const timeDiff = Date.parse(a.startsAt) - Date.parse(b.startsAt);
      if (timeDiff !== 0) return timeDiff;
      return a.title.localeCompare(b.title, "zh-CN");
    });
}

function sweepCache(now: number) {
  for (const [key, entry] of weeklyCache.entries()) {
    if (entry.staleUntil <= now) weeklyCache.delete(key);
  }
  for (const [key, entry] of economicDetailCache.entries()) {
    if (entry.staleUntil <= now) economicDetailCache.delete(key);
  }
}

function isPersistentCacheSchemaMissing(error: unknown) {
  const text = String((error as any)?.message || error || "").toLowerCase();
  return text.includes("no such table") || text.includes("system_response_cache");
}

function getPersistentTodayDataKey(timeZone: string, dateKey: string) {
  return `today-data:${TODAY_DATA_CACHE_SCHEMA_VERSION}:${timeZone}:${dateKey}`;
}

function normalizePersistentPayload(value: unknown): TodayDataWeekPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as TodayDataWeekPayload;
  if (!Array.isArray(payload.items)) return null;
  return {
    generatedAt: String(payload.generatedAt || ""),
    now: String(payload.now || ""),
    timeZone: String(payload.timeZone || TODAY_DATA_TIME_ZONE),
    weekStart: String(payload.weekStart || ""),
    weekEnd: String(payload.weekEnd || ""),
    items: payload.items
  };
}

async function readPersistentTodayData(
  key: string,
  now: number
): Promise<{ value: TodayDataWeekPayload; freshUntil: number; staleUntil: number } | null> {
  try {
    const row = await dbFirst<PersistentTodayDataCacheRow>(
      "select value_json, fresh_until_ms, stale_until_ms from system_response_cache where cache_key = ? limit 1",
      [key]
    );
    if (!row?.value_json) return null;
    const staleUntil = Number(row.stale_until_ms || 0);
    if (!staleUntil || staleUntil <= now) return null;
    const parsed = normalizePersistentPayload(JSON.parse(row.value_json));
    if (!parsed) return null;
    return {
      value: parsed,
      freshUntil: Number(row.fresh_until_ms || 0),
      staleUntil
    };
  } catch (error) {
    if (isPersistentCacheSchemaMissing(error)) return null;
    return null;
  }
}

async function writePersistentTodayData(key: string, value: TodayDataWeekPayload) {
  const now = Date.now();
  try {
    await dbRun(
      [
        "insert into system_response_cache (cache_key, value_json, fresh_until_ms, stale_until_ms, updated_at)",
        "values (?, ?, ?, ?, CURRENT_TIMESTAMP)",
        "on conflict(cache_key) do update set",
        "value_json = excluded.value_json,",
        "fresh_until_ms = excluded.fresh_until_ms,",
        "stale_until_ms = excluded.stale_until_ms,",
        "updated_at = CURRENT_TIMESTAMP"
      ].join(" "),
      [
        key,
        JSON.stringify(value),
        now + PERSISTENT_FRESH_TTL_MS,
        now + PERSISTENT_STALE_TTL_MS
      ]
    );
  } catch {
    // The memory cache still keeps the endpoint usable if the persistent cache is unavailable.
  }
}

async function buildWeeklyTodayData(
  date: Date = new Date(),
  timeZone: string = TODAY_DATA_TIME_ZONE,
  options: { fresh?: boolean } = {}
) {
  const { weekStart, weekEnd, days } = getWeekRange(date, timeZone);
  const visibleDays = getVisibleRangeDays(date, timeZone);
  const visibleDaySet = new Set(visibleDays);
  const visibleWeekStarts = Array.from(
    new Set(
      visibleDays.map((day) => {
        const bounds = getWeekBoundsForDateKey(day);
        return bounds.weekStart;
      })
    )
  );
  const useWeeklyStatic = visibleDays.every((day) => day >= weekStart && day <= weekEnd);
  const [weeklyEconomicsResult, weeklyEventsResult, weeklyHolidaysResult] = useWeeklyStatic
    ? await Promise.all([
        fetchWeekEconomics(weekStart, weekEnd)
          .then((rows) => ({ ok: true as const, rows }))
          .catch(() => ({ ok: false as const, rows: [] as DatedRow<Jin10EconomicRaw>[] })),
        fetchWeekEvents(weekStart, weekEnd)
          .then((rows) => ({ ok: true as const, rows }))
          .catch(() => ({ ok: false as const, rows: [] as DatedRow<Jin10EventRaw>[] })),
        fetchWeekHolidays(weekStart, weekEnd)
          .then((rows) => ({ ok: true as const, rows }))
          .catch(() => ({ ok: false as const, rows: [] as Jin10HolidayPageRaw[] }))
      ])
    : [
        { ok: false as const, rows: [] as DatedRow<Jin10EconomicRaw>[] },
        { ok: false as const, rows: [] as DatedRow<Jin10EventRaw>[] },
        { ok: false as const, rows: [] as Jin10HolidayPageRaw[] }
      ];

  const [dailyEconomicsResults, dailyEventsResults, holidayResults] =
    weeklyEconomicsResult.ok && weeklyEconomicsResult.rows.length
      ? [
          null,
          null,
          [
            weeklyHolidaysResult.ok && weeklyHolidaysResult.rows.length
            ? { ok: true as const, rows: weeklyHolidaysResult.rows }
            : await fetchWeekHolidayPage(weekStart)
                .then((rows) => ({ ok: true as const, rows }))
                .catch(() => ({ ok: false as const, rows: [] as Jin10HolidayPageRaw[] }))
          ]
        ]
      : await Promise.all([
          Promise.allSettled(visibleDays.map((day) => fetchDayEconomics(day))),
          Promise.allSettled(visibleDays.map((day) => fetchDayEvents(day))),
          Promise.all(
            visibleWeekStarts.map((start) =>
              fetchWeekHolidayPage(start)
                .then((rows) => ({ ok: true as const, rows }))
                .catch(() => ({ ok: false as const, rows: [] as Jin10HolidayPageRaw[] }))
            )
          )
        ]);

  const dailyEconomics =
    weeklyEconomicsResult.ok && weeklyEconomicsResult.rows.length
      ? groupWeekRowsByDay(weeklyEconomicsResult.rows.filter((entry) => visibleDaySet.has(entry.date)), visibleDays)
      : (dailyEconomicsResults || []).map(fulfilledOrEmpty);
  const dailyEvents =
    weeklyEventsResult.ok && weeklyEventsResult.rows.length
      ? groupWeekRowsByDay(weeklyEventsResult.rows.filter((entry) => visibleDaySet.has(entry.date)), visibleDays)
      : (dailyEventsResults || []).map(fulfilledOrEmpty);
  const holidayRows = holidayResults.flatMap((result) => result.rows).filter((row) => {
    const dateKey =
      pickDateOnly(row.date) || (row.date_unix ? formatDateKey(new Date(Number(row.date_unix) * 1000)) : null);
    return Boolean(dateKey && visibleDaySet.has(dateKey));
  });
  const economicDetailById = await fetchEconomicDetailMap(dailyEconomics.flat(), {
    referenceDate: date,
    network: false
  });

  const items = [
    ...dailyEconomics.flatMap((rows, index) => normalizeEconomicRows(rows, visibleDays[index], economicDetailById)),
    ...dailyEvents.flatMap((rows, index) => normalizeEventRows(rows, visibleDays[index])),
    ...normalizeHolidayRows(holidayRows, weekStart, weekEnd)
  ].sort((a, b) => {
    const timeDiff = Date.parse(a.startsAt) - Date.parse(b.startsAt);
    if (timeDiff !== 0) return timeDiff;
    if (a.kind !== b.kind) {
      const kindWeight = { economic: 0, event: 1, holiday: 2 } as const;
      return kindWeight[a.kind] - kindWeight[b.kind];
    }
    if (a.preciseTime !== b.preciseTime) return a.preciseTime ? -1 : 1;
    if (a.importance !== b.importance) return b.importance - a.importance;
    return a.title.localeCompare(b.title, "zh-CN");
  });

  return {
    generatedAt: new Date().toISOString(),
    now: date.toISOString(),
    timeZone,
    weekStart: visibleDays[0] || weekStart,
    weekEnd: visibleDays.at(-1) || weekEnd,
    items
  } satisfies TodayDataWeekPayload;
}

export async function getWeeklyTodayData(
  date: Date = new Date(),
  timeZone: string = TODAY_DATA_TIME_ZONE,
  options: { fresh?: boolean } = {}
) {
  const now = Date.now();
  const cacheKey = getVisibleRangeDays(date, timeZone)[0] || getWeekRange(date, timeZone).weekKey;
  const persistentKey = getPersistentTodayDataKey(timeZone, cacheKey);
  const fresh = Boolean(options.fresh);

  sweepCache(now);

  const cached = weeklyCache.get(cacheKey);
  if (!fresh && cached && cached.freshUntil > now) {
    return cached.value;
  }

  if (!fresh) {
    const persistent = await readPersistentTodayData(persistentKey, now);
    if (persistent) {
      weeklyCache.set(cacheKey, {
        freshUntil: Math.max(persistent.freshUntil, now + FRESH_TTL_MS),
        staleUntil: Math.max(persistent.staleUntil, now + STALE_TTL_MS),
        value: persistent.value
      });
      return persistent.value;
    }
  }

  const pending = weeklyInflight.get(cacheKey);
  if (!fresh && pending) return pending;

  const task = (async () => {
    try {
      const value = await buildWeeklyTodayData(date, timeZone, options);
      weeklyCache.set(cacheKey, {
        freshUntil: Date.now() + FRESH_TTL_MS,
        staleUntil: Date.now() + STALE_TTL_MS,
        value
      });
      void writePersistentTodayData(persistentKey, value);
      return value;
    } catch (error) {
      const stale = weeklyCache.get(cacheKey);
      if (!fresh && stale && stale.staleUntil > Date.now()) {
        return stale.value;
      }
      const persistent = await readPersistentTodayData(persistentKey, Date.now());
      if (persistent) return persistent.value;
      throw error;
    }
  })();

  weeklyInflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    weeklyInflight.delete(cacheKey);
  }
}
