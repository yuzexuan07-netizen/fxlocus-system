import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdmin } from "@/lib/system/guard";
import { getPagination } from "@/lib/system/pagination";
import { dbAll, dbFirst } from "@/lib/d1";
import { getAdminRecordReadMarkMap, resolveAdminRecordReadAt } from "@/lib/system/adminRecordReadMarks";
import { mapSystemApiError } from "@/lib/system/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 20_000;
const CACHE_MAX_KEYS = 480;
const STALE_GRACE_MS = 90_000;
type RecordsListPayload = {
  ok: true;
  items: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
};
const g = globalThis as {
  __fx_admin_records_list_cache?: Map<string, { exp: number; payload: RecordsListPayload }>;
  __fx_admin_records_list_inflight?: Map<string, Promise<RecordsListPayload>>;
};
if (!g.__fx_admin_records_list_cache) g.__fx_admin_records_list_cache = new Map();
if (!g.__fx_admin_records_list_inflight) g.__fx_admin_records_list_inflight = new Map();
const recordsListCache = g.__fx_admin_records_list_cache;
const recordsListInflight = g.__fx_admin_records_list_inflight;

const TypeParam = z.enum(["donate", "contact", "enrollment"]);

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function isMissingSchemaError(err: any) {
  const message = String(err?.message || "").toLowerCase();
  return message.includes("no such table") || message.includes("no such column");
}

function isNoSuchTableError(err: any) {
  return String(err?.message || "").toLowerCase().includes("no such table");
}

function isNoSuchColumnError(err: any) {
  return String(err?.message || "").toLowerCase().includes("no such column");
}

function sweepRecordsListCache(now: number) {
  if (!recordsListCache.size) return;
  for (const [key, value] of recordsListCache.entries()) {
    if (value.exp <= now) recordsListCache.delete(key);
  }
  if (recordsListCache.size <= CACHE_MAX_KEYS) return;
  const overflow = recordsListCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of recordsListCache.keys()) {
    recordsListCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

async function mergeReadMarks(
  recordType: "donate" | "contact" | "enrollment",
  rows: Array<Record<string, unknown>>
) {
  if (!rows.length) return rows;
  try {
    const ids = rows.map((row) => String(row.id || "")).filter(Boolean);
    if (!ids.length) return rows;
    const markMap = await getAdminRecordReadMarkMap(recordType, ids);
    return rows.map((row) => {
      const id = String(row.id || "");
      const mark = id ? markMap.get(id) || null : null;
      return {
        ...row,
        read_at: resolveAdminRecordReadAt(row as any, mark)
      };
    });
  } catch {
    return rows.map((row) => ({
      ...row,
      read_at: resolveAdminRecordReadAt(row as any, null)
    }));
  }
}

function toRecordItemsFromJoinedRows(
  rows: any[],
  options: { includeRowReadAt: boolean; includeMarkReadAt: boolean }
) {
  return (rows || []).map((row: any) => {
    const rowReadAt = options.includeRowReadAt ? row.__row_read_at ?? null : null;
    const markReadAt = options.includeMarkReadAt ? row.__mark_read_at ?? null : null;
    return {
      id: row.id,
      type: row.type,
      created_at: row.created_at,
      email: row.email,
      name: row.name,
      payload: row.payload,
      content: row.content,
      read_at: resolveAdminRecordReadAt(
        {
          read_at: rowReadAt,
          payload: row.payload,
          content: row.content
        },
        markReadAt
      )
    } as Record<string, unknown>;
  });
}

async function loadRecordsFromRecordsTable(
  recordType: "donate" | "contact" | "enrollment",
  page: number,
  pageSize: number,
  from: number
): Promise<RecordsListPayload> {
  const plans = [
    { includeJoin: true, includeRowReadAt: true },
    { includeJoin: true, includeRowReadAt: false },
    { includeJoin: false, includeRowReadAt: true },
    { includeJoin: false, includeRowReadAt: false }
  ] as const;

  let lastError: unknown = null;
  for (const plan of plans) {
    const rowReadSql = plan.includeRowReadAt ? "r.read_at as __row_read_at" : "null as __row_read_at";
    const markJoinSql = plan.includeJoin
      ? "left join admin_record_read_marks m on m.record_type = ? and m.record_id = r.id"
      : "";
    const markReadSql = plan.includeJoin ? "m.read_at as __mark_read_at" : "null as __mark_read_at";
    const params: unknown[] = [];
    if (plan.includeJoin) params.push(recordType);
    params.push(recordType, pageSize, from);

    try {
      const rows = await dbAll(
        [
          "select r.id, r.type, r.created_at, r.email, r.name, r.payload, r.content,",
          `${rowReadSql},`,
          `${markReadSql},`,
          "count(1) over() as __total",
          "from records r",
          markJoinSql,
          "where r.type = ?",
          "order by r.created_at desc",
          "limit ? offset ?"
        ].join(" "),
        params
      );

      let items = toRecordItemsFromJoinedRows(rows || [], {
        includeRowReadAt: plan.includeRowReadAt,
        includeMarkReadAt: plan.includeJoin
      });
      if (!plan.includeJoin && items.length) {
        items = await mergeReadMarks(recordType, items);
      }

      let total = Number((rows || [])[0]?.__total || 0);
      if (!rows.length && from > 0) {
        const countRow = await dbFirst<{ total: number }>("select count(1) as total from records where type = ?", [
          recordType
        ]);
        total = Number(countRow?.total || 0);
      }

      return { ok: true, items, page, pageSize, total };
    } catch (err: any) {
      if (isNoSuchColumnError(err) || isNoSuchTableError(err)) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("RECORDS_QUERY_FAILED");
}

async function loadRecordsFromContactSubmissions(
  page: number,
  pageSize: number,
  from: number
): Promise<RecordsListPayload> {
  try {
    const rows = await dbAll(
      [
        "select c.id,",
        "'contact' as type,",
        "c.created_at, c.email, c.name, c.payload, c.message as content,",
        "m.read_at as __mark_read_at,",
        "count(1) over() as __total",
        "from contact_submissions c",
        "left join admin_record_read_marks m on m.record_type = ? and m.record_id = c.id",
        "order by c.created_at desc",
        "limit ? offset ?"
      ].join(" "),
      ["contact", pageSize, from]
    );
    let total = Number((rows || [])[0]?.__total || 0);
    if (!rows.length && from > 0) {
      const countRow = await dbFirst<{ total: number }>("select count(1) as total from contact_submissions");
      total = Number(countRow?.total || 0);
    }
    const items = (rows || []).map((row: any) => ({
      id: row.id,
      type: "contact",
      created_at: row.created_at,
      email: row.email,
      name: row.name,
      payload: row.payload,
      content: row.content,
      read_at: resolveAdminRecordReadAt(
        {
          read_at: null,
          payload: row.payload,
          content: row.content
        },
        row.__mark_read_at ?? null
      )
    }));
    return { ok: true, items, page, pageSize, total };
  } catch (err: any) {
    if (!isNoSuchTableError(err)) throw err;
    const countRow = await dbFirst<{ total: number }>("select count(1) as total from contact_submissions", []);
    const total = Number(countRow?.total || 0);
    const rawRows = await dbAll(
      [
        "select id, created_at, email, name, payload, message as content",
        "from contact_submissions",
        "order by created_at desc",
        "limit ? offset ?"
      ].join(" "),
      [pageSize, from]
    );
    const normalized = await mergeReadMarks(
      "contact",
      (rawRows || []).map((row: any) => ({
        id: row.id,
        type: "contact",
        created_at: row.created_at,
        email: row.email,
        name: row.name,
        payload: row.payload,
        content: row.content,
        read_at: null
      }))
    );
    return { ok: true, items: normalized, page, pageSize, total };
  }
}

export async function GET(req: NextRequest) {
  let cacheKeyForFallback = "";
  let fallbackType: "donate" | "contact" | "enrollment" = "contact";
  let fallbackPage = 1;
  let fallbackPageSize = 20;
  try {
    await requireSuperAdmin();
    const type = TypeParam.safeParse(req.nextUrl.searchParams.get("type"));
    if (!type.success) return json({ ok: false, error: "INVALID_TYPE" }, 400);
    const { page, pageSize, from } = getPagination(req, { defaultPageSize: 20, maxPageSize: 200 });
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const cacheKey = `${type.data}:${page}:${pageSize}:${from}`;
    cacheKeyForFallback = cacheKey;
    fallbackType = type.data;
    fallbackPage = page;
    fallbackPageSize = pageSize;

    if (!fresh) {
      const now = Date.now();
      sweepRecordsListCache(now);
      const cached = recordsListCache.get(cacheKey);
      if (cached && cached.exp > now) {
        return json(cached.payload);
      }
    }

    let task: Promise<RecordsListPayload> | undefined = fresh
      ? undefined
      : recordsListInflight.get(cacheKey);
    if (!task) {
      task = (async () => {
        try {
          return await loadRecordsFromRecordsTable(type.data, page, pageSize, from);
        } catch (err: any) {
          if (type.data === "contact" && isNoSuchTableError(err)) {
            return await loadRecordsFromContactSubmissions(page, pageSize, from);
          }
          throw err;
        }
      })();
      if (!fresh) recordsListInflight.set(cacheKey, task);
    }
    try {
      const payload = await task;
      if (!fresh) recordsListCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
      return json(payload);
    } catch (err: any) {
      if (!isMissingSchemaError(err) || type.data !== "contact") throw err;
      if (!isNoSuchTableError(err)) throw err;
      const payload = await loadRecordsFromContactSubmissions(page, pageSize, from);
      if (!fresh) recordsListCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
      return json(payload);
    } finally {
      if (!fresh) recordsListInflight.delete(cacheKey);
    }
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    if (mapped.code === "UNAUTHORIZED" || mapped.code === "FORBIDDEN" || mapped.code === "FROZEN") {
      return json({ ok: false, error: mapped.code }, mapped.status);
    }
    if (cacheKeyForFallback) {
      const cached = findReusableRecordsPayload(cacheKeyForFallback);
      if (cached) {
        return json({ ...cached, transient: true });
      }
    }
    return json(
      {
        ok: true,
        items: [],
        page: fallbackPage,
        pageSize: fallbackPageSize,
        total: 0,
        transient: true,
        type: fallbackType
      },
      200
    );
  }
}

function findReusableRecordsPayload(cacheKey: string) {
  const entry = recordsListCache.get(cacheKey);
  if (!entry) return null;
  const now = Date.now();
  if (entry.exp > now) return entry.payload;
  if (entry.exp + STALE_GRACE_MS > now) return entry.payload;
  return null;
}
