import { NextRequest, NextResponse } from "next/server";

import { requireSystemUser } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { fetchStudentSupportNames } from "@/lib/system/studentSupport";
import { buildSqlInFilter, dbAll, dbFirst } from "@/lib/d1";
import { getPagination } from "@/lib/system/pagination";
import { mapSystemApiError } from "@/lib/system/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 20_000;
const CACHE_MAX_KEYS = 480;
const STALE_GRACE_MS = 90_000;
type FileRequestsPayload = {
  ok: true;
  items: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
};
const g = globalThis as {
  __fx_admin_file_requests_cache?: Map<string, { exp: number; payload: FileRequestsPayload }>;
  __fx_admin_file_requests_inflight?: Map<string, Promise<FileRequestsPayload>>;
};
if (!g.__fx_admin_file_requests_cache) g.__fx_admin_file_requests_cache = new Map();
if (!g.__fx_admin_file_requests_inflight) g.__fx_admin_file_requests_inflight = new Map();
const fileRequestsCache = g.__fx_admin_file_requests_cache;
const fileRequestsInflight = g.__fx_admin_file_requests_inflight;
const REQUEST_ROW_FIELD_SETS = [
  [
    "r.user_id, r.file_id, r.status, r.requested_at,",
    "p.full_name as user_full_name, p.email as user_email, p.phone as user_phone, p.leader_id as user_leader_id, p.role as user_role,",
    "f.category as file_category, f.name as file_name, f.description as file_description, f.size_bytes as file_size_bytes, f.mime_type as file_mime_type, f.created_at as file_created_at"
  ].join(" "),
  [
    "r.user_id, r.file_id, r.status, r.requested_at,",
    "p.full_name as user_full_name, p.email as user_email, null as user_phone, null as user_leader_id, p.role as user_role,",
    "f.category as file_category, f.name as file_name, f.description as file_description, f.size_bytes as file_size_bytes, f.mime_type as file_mime_type, f.created_at as file_created_at"
  ].join(" ")
] as const;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function sweepFileRequestsCache(now: number) {
  if (!fileRequestsCache.size) return;
  for (const [key, value] of fileRequestsCache.entries()) {
    if (value.exp <= now) fileRequestsCache.delete(key);
  }
  if (fileRequestsCache.size <= CACHE_MAX_KEYS) return;
  const overflow = fileRequestsCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of fileRequestsCache.keys()) {
    fileRequestsCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function findReusableFileRequestsPayload(cacheKey: string) {
  const entry = fileRequestsCache.get(cacheKey);
  if (!entry) return null;
  const now = Date.now();
  if (entry.exp > now) return entry.payload;
  if (entry.exp + STALE_GRACE_MS > now) return entry.payload;
  return null;
}

async function fetchRequestRows(whereSql: string, params: unknown[], pageSize: number, from: number) {
  for (const fields of REQUEST_ROW_FIELD_SETS) {
    try {
      return await dbAll(
        [
          `select ${fields},`,
          "count(1) over() as __total",
          "from file_access_requests r",
          "join profiles p on p.id = r.user_id",
          "left join files f on f.id = r.file_id",
          whereSql,
          "order by r.requested_at desc",
          "limit ? offset ?"
        ].join(" "),
        [...params, pageSize, from]
      );
    } catch (error: any) {
      const message = String(error?.message || "").toLowerCase();
      if (!message.includes("no such column")) throw error;
    }
  }
  return [] as any[];
}

export async function GET(req: NextRequest) {
  let cacheKeyForFallback = "";
  let fallbackPage = 1;
  let fallbackPageSize = 20;
  try {
    const { user } = await requireSystemUser();
    if (!(user.role === "super_admin" || user.role === "leader" || user.role === "assistant")) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const scopeIds =
      user.role === "leader"
        ? await fetchLeaderTreeIds(user.id)
        : user.role === "assistant"
          ? await fetchAssistantCreatedUserIds(user.id)
          : null;

    const studentQuery = String(req.nextUrl.searchParams.get("studentQuery") || "").trim().toLowerCase();
    const fileQuery = String(req.nextUrl.searchParams.get("fileQuery") || "").trim().toLowerCase();
    const { page, pageSize, from } = getPagination(req, { defaultPageSize: 20, maxPageSize: 200 });
    fallbackPage = page;
    fallbackPageSize = pageSize;
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";

    if (scopeIds && !scopeIds.length) {
      return json({ ok: true, items: [], page, pageSize, total: 0 });
    }

    const where: string[] = ["r.status = ?"];
    const whereParams: unknown[] = ["requested"];
    if (scopeIds) {
      const scopedFilter = buildSqlInFilter("r.user_id", scopeIds);
      if (scopedFilter.sql) {
        where.push(scopedFilter.sql);
        whereParams.push(...scopedFilter.params);
      }
    }
    if (studentQuery) {
      where.push(
        "(lower(coalesce(p.full_name, '')) like ? or lower(coalesce(p.email, '')) like ? or lower(coalesce(p.phone, '')) like ?)"
      );
      const keyword = `%${studentQuery}%`;
      whereParams.push(keyword, keyword, keyword);
    }
    if (fileQuery) {
      where.push(
        "(lower(coalesce(f.category, '')) like ? or lower(coalesce(f.name, '')) like ? or lower(coalesce(f.description, '')) like ?)"
      );
      const keyword = `%${fileQuery}%`;
      whereParams.push(keyword, keyword, keyword);
    }
    const whereSql = `where ${where.join(" and ")}`;
    const cacheKey = `${user.id}:${user.role}:${studentQuery}:${fileQuery}:${page}:${pageSize}:${from}`;
    cacheKeyForFallback = cacheKey;
    if (!fresh) {
      const now = Date.now();
      sweepFileRequestsCache(now);
      const cached = fileRequestsCache.get(cacheKey);
      if (cached && cached.exp > now) {
        return json(cached.payload);
      }
    }

    let task: Promise<FileRequestsPayload> | undefined = fresh
      ? undefined
      : fileRequestsInflight.get(cacheKey);
    if (!task) {
      task = (async (): Promise<FileRequestsPayload> => {
        const rows = await fetchRequestRows(whereSql, whereParams, pageSize, from);
        let total = Number((rows || [])[0]?.__total || 0);
        if (!(rows || []).length && from > 0) {
          const countRow = await dbFirst<{ total: number }>(
            [
              "select count(1) as total",
              "from file_access_requests r",
              "join profiles p on p.id = r.user_id",
              "left join files f on f.id = r.file_id",
              whereSql
            ].join(" "),
            whereParams
          );
          total = Number(countRow?.total || 0);
        }
        if (!total) return { ok: true, items: [], page, pageSize, total: 0 };

        const normalizedRows = (rows || []).map((row: any) => {
          const copy = { ...row };
          delete copy.__total;
          return copy;
        });
        const scopedUserIds = Array.from(
          new Set(normalizedRows.map((r: any) => String(r.user_id || "")).filter(Boolean))
        );
        let supportMap = new Map();
        try {
          supportMap = await fetchStudentSupportNames(scopedUserIds);
        } catch {
          supportMap = new Map();
        }

        const items = normalizedRows.map((r: any) => {
          const support = supportMap.get(String(r.user_id));
          return {
            user_id: r.user_id,
            file_id: r.file_id,
            status: r.status,
            requested_at: r.requested_at,
            user: {
              id: r.user_id,
              full_name: r.user_full_name ?? null,
              email: r.user_email ?? null,
              phone: r.user_phone ?? null,
              leader_id: r.user_leader_id ?? null,
              role: r.user_role ?? null,
              support_name: support?.displayName || null,
              assistant_name: support?.assistantName || null,
              coach_name: support?.coachName || null
            },
            file: r.file_id
              ? {
                  id: r.file_id,
                  category: r.file_category ?? null,
                  name: r.file_name ?? null,
                  description: r.file_description ?? null,
                  size_bytes: Number(r.file_size_bytes || 0),
                  mime_type: r.file_mime_type ?? null,
                  created_at: r.file_created_at ?? null
                }
              : null
          };
        });
        return { ok: true, items, page, pageSize, total };
      })();
      if (!fresh) fileRequestsInflight.set(cacheKey, task);
    }
    try {
      const payload = await task;
      if (!fresh) {
        fileRequestsCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
      }
      return json(payload);
    } finally {
      if (!fresh) fileRequestsInflight.delete(cacheKey);
    }
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    if (mapped.code === "UNAUTHORIZED" || mapped.code === "FORBIDDEN" || mapped.code === "FROZEN") {
      return json({ ok: false, error: mapped.code }, mapped.status);
    }
    if (cacheKeyForFallback) {
      const cached = findReusableFileRequestsPayload(cacheKeyForFallback);
      if (cached) return json({ ...cached, transient: true });
    }
    return json({ ok: true, items: [], page: fallbackPage, pageSize: fallbackPageSize, total: 0, transient: true });
  }
}
