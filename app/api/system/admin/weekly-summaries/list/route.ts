import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { buildSqlInFilter, dbAll, dbFirst } from "@/lib/d1";
import { getPagination } from "@/lib/system/pagination";
import { buildStorageProxyUrl } from "@/lib/storage/objectUrl";
import { isMissingSchemaError, toSchemaWarning } from "@/lib/system/schema";
import { mapSystemApiError } from "@/lib/system/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 8_000;
const CACHE_MAX_KEYS = 2000;
const CoachParam = z.string().trim().min(1).max(128);
type WeeklySummariesPayload = {
  ok: true;
  items: Array<Record<string, unknown>>;
  leaders: Array<{ id: string; full_name: string | null; email: string | null }>;
  page: number;
  pageSize: number;
  total: number;
  schemaWarning?: string;
};
const g = globalThis as {
  __fx_admin_weekly_summaries_cache?: Map<string, { exp: number; payload: WeeklySummariesPayload }>;
  __fx_admin_weekly_summaries_inflight?: Map<string, Promise<WeeklySummariesPayload>>;
};
if (!g.__fx_admin_weekly_summaries_cache) g.__fx_admin_weekly_summaries_cache = new Map();
if (!g.__fx_admin_weekly_summaries_inflight) g.__fx_admin_weekly_summaries_inflight = new Map();
const weeklySummariesCache = g.__fx_admin_weekly_summaries_cache;
const weeklySummariesInflight = g.__fx_admin_weekly_summaries_inflight;

const PROFILE_FIELD_SETS = [
  "id, full_name, email, phone, role, leader_id",
  "id, full_name, email, role, leader_id",
  "id, full_name, email, role",
  "id, email, role"
];

const WEEKLY_ROW_FIELD_SETS = [
  [
    "w.id, w.user_id, w.leader_id, w.student_name, w.summary_text, w.review_note, w.reviewed_at, w.created_at,",
    "w.strategy_text,",
    "w.strategy_bucket, w.strategy_path, w.strategy_name, w.strategy_mime_type,",
    "w.curve_text,",
    "w.curve_bucket, w.curve_path, w.curve_name, w.curve_mime_type,",
    "w.stats_text,",
    "w.stats_bucket, w.stats_path, w.stats_name, w.stats_mime_type,",
    "p.full_name as user_full_name, p.email as user_email, p.phone as user_phone, p.role as user_role, p.leader_id as user_leader_id"
  ].join(" "),
  [
    "w.id, w.user_id, w.leader_id, w.student_name, w.summary_text, w.review_note, w.reviewed_at, w.created_at,",
    "null as strategy_text,",
    "w.strategy_bucket, w.strategy_path, w.strategy_name,",
    "null as curve_text,",
    "w.curve_bucket, w.curve_path, w.curve_name,",
    "null as stats_text,",
    "w.stats_bucket, w.stats_path, w.stats_name,",
    "p.full_name as user_full_name, p.email as user_email, null as user_phone, p.role as user_role, null as user_leader_id"
  ].join(" "),
  [
    "w.id, w.user_id, w.leader_id, w.student_name, w.summary_text, w.review_note, w.reviewed_at, w.created_at,",
    "null as strategy_text,",
    "w.strategy_bucket, w.strategy_path, w.strategy_name,",
    "null as curve_text,",
    "w.curve_bucket, w.curve_path, w.curve_name,",
    "null as stats_text,",
    "w.stats_bucket, w.stats_path, w.stats_name,",
    "null as user_full_name, null as user_email, null as user_phone, null as user_role, null as user_leader_id"
  ].join(" ")
];

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function sweepWeeklySummariesCache(now: number) {
  if (!weeklySummariesCache.size) return;
  for (const [key, value] of weeklySummariesCache.entries()) {
    if (value.exp <= now) weeklySummariesCache.delete(key);
  }
  if (weeklySummariesCache.size <= CACHE_MAX_KEYS) return;
  const overflow = weeklySummariesCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of weeklySummariesCache.keys()) {
    weeklySummariesCache.delete(key);
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
      const rows = await dbAll(
        `select ${fields} from profiles where ${scopedFilter.sql}`,
        scopedFilter.params
      );
      return rows;
    } catch (error: any) {
      const message = String(error?.message || "");
      if (!message.toLowerCase().includes("no such column")) throw error;
    }
  }
  return [];
}

async function fetchWeeklyRows(whereSql: string, params: unknown[], pageSize: number, from: number) {
  let lastError: any = null;
  for (const fields of WEEKLY_ROW_FIELD_SETS) {
    try {
      const rows = await dbAll(
        [
          `select ${fields},`,
          "count(1) over() as __total",
          "from weekly_summaries w",
          "join profiles p on p.id = w.user_id",
          whereSql,
          "order by case when w.reviewed_at is null then 0 else 1 end asc, w.created_at desc",
          "limit ? offset ?"
        ].join(" "),
        [...params, pageSize, from]
      );
      return rows.map((row: any) => ({
        ...row,
        strategy_text: row.strategy_text ?? null,
        strategy_mime_type: row.strategy_mime_type ?? null,
        curve_text: row.curve_text ?? null,
        curve_mime_type: row.curve_mime_type ?? null,
        stats_text: row.stats_text ?? null,
        stats_mime_type: row.stats_mime_type ?? null
      }));
    } catch (error: any) {
      if (!isMissingSchemaError(error)) throw error;
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

async function fetchLeaderIds() {
  try {
    const rows = await dbAll<{ id: string }>(
      "select id from profiles where role = ? order by created_at desc limit 2000",
      ["leader"]
    );
    return rows.map((r) => String(r.id));
  } catch (error: any) {
    if (!isMissingSchemaError(error)) throw error;
    const rows = await dbAll<{ id: string }>("select id from profiles where role = ? limit 2000", ["leader"]);
    return rows.map((r) => String(r.id));
  }
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireManager();
    const roleParam = (req.nextUrl.searchParams.get("role") || "").trim();
    const roleFilter = roleParam === "leader" ? "leader" : roleParam === "assistant" ? "assistant" : "student";
    const leaderId = (req.nextUrl.searchParams.get("leaderId") || "").trim();
    const coachRaw = (req.nextUrl.searchParams.get("coachId") || "").trim();
    const parsedCoach = coachRaw ? CoachParam.safeParse(coachRaw) : null;
    if (coachRaw && !parsedCoach?.success) return json({ ok: false, error: "INVALID_COACH" }, 400);
    const coachId = parsedCoach?.success ? parsedCoach.data : "";
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";

    const { page, pageSize, from } = getPagination(req, { defaultPageSize: 20, maxPageSize: 200 });

    let scopeIds: string[] | null = null;
    if (coachId) {
      if (user.role === "assistant") return json({ ok: false, error: "FORBIDDEN" }, 403);
      if (user.role === "coach" && coachId !== user.id) return json({ ok: false, error: "FORBIDDEN" }, 403);
      if (user.role === "leader") {
        const treeIds = await fetchLeaderTreeIds(user.id);
        if (!treeIds.includes(coachId)) return json({ ok: false, error: "FORBIDDEN" }, 403);
      }
      scopeIds = await fetchCoachAssignedUserIds(coachId);
    } else if (user.role === "leader") {
      scopeIds = await fetchLeaderTreeIds(user.id);
    } else if (user.role === "coach") {
      scopeIds = await fetchCoachAssignedUserIds(user.id);
    } else if (user.role === "assistant") {
      scopeIds = await fetchAssistantCreatedUserIds(user.id);
    } else if (leaderId && (roleFilter === "student" || roleFilter === "assistant")) {
      scopeIds = await fetchLeaderTreeIds(leaderId);
    } else if (leaderId && roleFilter === "leader") {
      scopeIds = [leaderId];
    }

    if (scopeIds && !scopeIds.length) return json({ ok: true, items: [], leaders: [], page, pageSize, total: 0 });

    const where: string[] = [];
    const params: unknown[] = [];
    if (scopeIds) {
      const scopedFilter = buildSqlInFilter("w.user_id", scopeIds);
      if (scopedFilter.sql) {
        where.push(scopedFilter.sql);
        params.push(...scopedFilter.params);
      }
    }
    if (roleFilter === "student") {
      where.push("p.role in ('student','trader')");
    } else if (roleFilter === "assistant") {
      where.push("p.role = 'assistant'");
    } else if (roleFilter === "leader") {
      where.push("p.role = 'leader'");
    }
    const whereSql = where.length ? `where ${where.join(" and ")}` : "";
    const cacheKey = `${user.id}:${user.role}:${roleFilter}:${leaderId}:${coachId}:${page}:${pageSize}:${from}`;
    if (!fresh) {
      const now = Date.now();
      sweepWeeklySummariesCache(now);
      const cached = weeklySummariesCache.get(cacheKey);
      if (cached && cached.exp > now) {
        return json(cached.payload);
      }
    }

    let task: Promise<WeeklySummariesPayload> | undefined = fresh
      ? undefined
      : weeklySummariesInflight.get(cacheKey);
    if (!task) {
      task = (async (): Promise<WeeklySummariesPayload> => {
        let rows: any[] = [];
        try {
          rows = await fetchWeeklyRows(whereSql, params, pageSize, from);
        } catch (error: any) {
          if (!isMissingSchemaError(error)) throw error;
          return {
            ok: true,
            items: [],
            leaders: [],
            page,
            pageSize,
            total: 0,
            schemaWarning: toSchemaWarning(error)
          };
        }

        let total = Number((rows || [])[0]?.__total || 0);
        if (!(rows || []).length && from > 0) {
          try {
            const countRow = await dbFirst<{ total: number }>(
              `select count(1) as total from weekly_summaries w join profiles p on p.id = w.user_id ${whereSql}`,
              params
            );
            total = Number(countRow?.total || 0);
          } catch (error: any) {
            if (!isMissingSchemaError(error)) throw error;
            return {
              ok: true,
              items: [],
              leaders: [],
              page,
              pageSize,
              total: 0,
              schemaWarning: toSchemaWarning(error)
            };
          }
        }

        let leaders: Array<{ id: string; full_name: string | null; email: string | null }> = [];
        if (user.role === "super_admin") {
          const leaderRows = await fetchProfilesByIds(await fetchLeaderIds());
          leaders = leaderRows.map((row: any) => ({
            id: String(row.id),
            full_name: row.full_name ?? null,
            email: row.email ?? null
          }));
        }
        if (!total) {
          return { ok: true, items: [], leaders, page, pageSize, total: 0 };
        }

        const pageRows = (rows || []).map((row: any) => {
          const copy = { ...row };
          delete copy.__total;
          return copy;
        });
        const items = pageRows.map((row: any) => ({
          id: row.id,
          user_id: row.user_id,
          leader_id: row.leader_id,
          student_name: row.student_name,
          summary_text: row.summary_text,
          review_note: row.review_note,
          reviewed_at: row.reviewed_at,
          created_at: row.created_at,
          strategy_text: row.strategy_text,
          strategy_name: row.strategy_name,
          strategy_mime_type: row.strategy_mime_type,
          strategy_url:
            row.strategy_bucket && row.strategy_path
              ? buildStorageProxyUrl(row.strategy_bucket, row.strategy_path, {
                  filename: row.strategy_name,
                  contentType: row.strategy_mime_type
              })
            : null,
          curve_text: row.curve_text,
          curve_name: row.curve_name,
          curve_mime_type: row.curve_mime_type,
          curve_url:
            row.curve_bucket && row.curve_path
              ? buildStorageProxyUrl(row.curve_bucket, row.curve_path, {
                  filename: row.curve_name,
                  contentType: row.curve_mime_type
              })
            : null,
          stats_text: row.stats_text,
          stats_name: row.stats_name,
          stats_mime_type: row.stats_mime_type,
          stats_url:
            row.stats_bucket && row.stats_path
              ? buildStorageProxyUrl(row.stats_bucket, row.stats_path, {
                  filename: row.stats_name,
                  contentType: row.stats_mime_type
                })
              : null,
          user: row.user_id
            ? {
                id: row.user_id,
                full_name: row.user_full_name ?? null,
                email: row.user_email ?? null,
                phone: row.user_phone ?? null,
                role: row.user_role ?? null,
                leader_id: row.user_leader_id ?? null
              }
            : null
        }));

        return { ok: true, items, leaders, page, pageSize, total };
      })();
      if (!fresh) weeklySummariesInflight.set(cacheKey, task);
    }
    try {
      const payload = await task;
      if (!fresh) {
        weeklySummariesCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
      }
      return json(payload);
    } finally {
      if (!fresh) weeklySummariesInflight.delete(cacheKey);
    }
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    if (mapped.code === "DB_ERROR" && isMissingSchemaError(e)) {
      return json({
        ok: true,
        items: [],
        leaders: [],
        page: 1,
        pageSize: 20,
        total: 0,
        schemaWarning: toSchemaWarning(e)
      });
    }
    console.error("[admin/weekly-summaries/list] unexpected error:", e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
