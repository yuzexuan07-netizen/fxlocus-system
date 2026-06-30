import { NextRequest, NextResponse } from "next/server";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { getPagination } from "@/lib/system/pagination";
import { buildSqlInFilter, dbAll, dbFirst } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { buildStorageProxyUrl } from "@/lib/storage/objectUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 8_000;
const CACHE_MAX_KEYS = 2000;
type ClassicTradesPayload = {
  ok: true;
  items: Array<Record<string, unknown>>;
  leaders: Array<{ id: string; full_name: string | null; email: string | null }>;
  page: number;
  pageSize: number;
  total: number;
};
const g = globalThis as {
  __fx_admin_classic_trades_cache?: Map<string, { exp: number; payload: ClassicTradesPayload }>;
  __fx_admin_classic_trades_inflight?: Map<string, Promise<ClassicTradesPayload>>;
};
if (!g.__fx_admin_classic_trades_cache) g.__fx_admin_classic_trades_cache = new Map();
if (!g.__fx_admin_classic_trades_inflight) g.__fx_admin_classic_trades_inflight = new Map();
const classicTradesCache = g.__fx_admin_classic_trades_cache;
const classicTradesInflight = g.__fx_admin_classic_trades_inflight;

const PROFILE_FIELD_SETS = [
  "id, full_name, email, phone, role, leader_id",
  "id, full_name, email, role, leader_id",
  "id, full_name, email, role",
  "id, email, role"
];

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function sweepClassicTradesCache(now: number) {
  if (!classicTradesCache.size) return;
  for (const [key, value] of classicTradesCache.entries()) {
    if (value.exp <= now) classicTradesCache.delete(key);
  }
  if (classicTradesCache.size <= CACHE_MAX_KEYS) return;
  const overflow = classicTradesCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of classicTradesCache.keys()) {
    classicTradesCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

async function fetchProfilesByIds(ids: string[]) {
  if (!ids.length) return [];
  const scopedFilter = buildSqlInFilter("id", ids);
  if (!scopedFilter.sql) return [];
  for (const fields of PROFILE_FIELD_SETS) {
    try {
      return await dbAll(`select ${fields} from profiles where ${scopedFilter.sql}`, scopedFilter.params);
    } catch (error: any) {
      const message = String(error?.message || "");
      if (!message.toLowerCase().includes("no such column")) throw error;
    }
  }
  return [];
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireManager();
    if (user.role === "coach") return json({ ok: false, error: "FORBIDDEN" }, 403);
    const leaderId = (req.nextUrl.searchParams.get("leaderId") || "").trim();
    const { page, pageSize, from } = getPagination(req, { defaultPageSize: 20, maxPageSize: 200 });
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";

    let scopeIds: string[] | null = null;
    if (user.role === "leader") {
      scopeIds = await fetchLeaderTreeIds(user.id);
    } else if (user.role === "assistant") {
      scopeIds = await fetchAssistantCreatedUserIds(user.id);
    } else if (leaderId) {
      scopeIds = await fetchLeaderTreeIds(leaderId);
    }
    if (scopeIds && !scopeIds.length) return json({ ok: true, items: [], leaders: [], page, pageSize, total: 0 });

    const where: string[] = [];
    const params: unknown[] = [];
    if (scopeIds) {
      const scopedFilter = buildSqlInFilter("ct.user_id", scopeIds);
      if (scopedFilter.sql) {
        where.push(scopedFilter.sql);
        params.push(...scopedFilter.params);
      }
    }
    const whereSql = where.length ? `where ${where.join(" and ")}` : "";
    const cacheKey = `${user.id}:${user.role}:${leaderId}:${page}:${pageSize}:${from}`;
    if (!fresh) {
      const now = Date.now();
      sweepClassicTradesCache(now);
      const cached = classicTradesCache.get(cacheKey);
      if (cached && cached.exp > now) {
        return json(cached.payload);
      }
    }

    let task: Promise<ClassicTradesPayload> | undefined = fresh
      ? undefined
      : classicTradesInflight.get(cacheKey);
    if (!task) {
      task = (async (): Promise<ClassicTradesPayload> => {
        const rows = await dbAll(
          [
            "select ct.id, ct.user_id, ct.leader_id, ct.reason, ct.review_note, ct.reviewed_at, ct.created_at,",
            "ct.image_bucket, ct.image_path, ct.image_name, ct.image_mime_type,",
            "count(1) over() as __total",
            "from classic_trades ct",
            whereSql,
            "order by case when ct.reviewed_at is null then 0 else 1 end asc, ct.created_at desc",
            "limit ? offset ?"
          ].join(" "),
          [...params, pageSize, from]
        );

        let total = Number((rows || [])[0]?.__total || 0);
        if (!(rows || []).length && from > 0) {
          const countRow = await dbFirst<{ total: number }>(
            `select count(1) as total from classic_trades ct ${whereSql}`,
            params
          );
          total = Number(countRow?.total || 0);
        }

        const normalizedRows = (rows || []).map((row: any) => {
          const copy = { ...row };
          delete copy.__total;
          return copy;
        });
        const userIds = Array.from(
          new Set(
            normalizedRows
              .map((row: any) => String(row?.user_id || ""))
              .filter(Boolean)
          )
        );
        const users = await fetchProfilesByIds(userIds);
        const usersById = new Map<string, any>(users.map((row: any) => [String(row.id), row]));

        let leaders: Array<{ id: string; full_name: string | null; email: string | null }> = [];
        if (user.role === "super_admin") {
          const leaderIds = (
            await dbAll<{ id: string }>("select id from profiles where role = ? order by created_at desc limit 2000", [
              "leader"
            ])
          ).map((row) => String(row.id));
          const leaderRows = await fetchProfilesByIds(leaderIds);
          leaders = leaderRows.map((row: any) => ({
            id: String(row.id),
            full_name: row.full_name ?? null,
            email: row.email ?? null
          }));
        }

        const items = normalizedRows.map((row: any) => ({
          id: row.id,
          user_id: row.user_id,
          leader_id: row.leader_id,
          reason: row.reason,
          review_note: row.review_note,
          reviewed_at: row.reviewed_at,
          created_at: row.created_at,
          image_name: row.image_name,
          image_mime_type: row.image_mime_type,
          image_url:
            row.image_bucket && row.image_path
              ? buildStorageProxyUrl(row.image_bucket, row.image_path, {
                  filename: row.image_name,
                  contentType: row.image_mime_type
                })
              : null,
          user: usersById.get(String(row.user_id || "")) || null
        }));

        return { ok: true, items, leaders, page, pageSize, total };
      })();
      if (!fresh) classicTradesInflight.set(cacheKey, task);
    }
    try {
      const payload = await task;
      if (!fresh) {
        classicTradesCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
      }
      return json(payload);
    } finally {
      if (!fresh) classicTradesInflight.delete(cacheKey);
    }
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
