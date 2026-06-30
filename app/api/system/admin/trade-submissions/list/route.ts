import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { getPagination } from "@/lib/system/pagination";
import { fetchStudentSupportNames } from "@/lib/system/studentSupport";
import { buildSqlInFilter, dbAll, dbFirst, sqlPlaceholders } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 3_000;
const CACHE_MAX_KEYS = 480;
const STALE_GRACE_MS = 90_000;
type TradeSubmissionsPayload = {
  ok: true;
  items: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
  pendingTotal: number;
};
const g = globalThis as {
  __fx_admin_trade_submissions_cache?: Map<string, { exp: number; payload: TradeSubmissionsPayload }>;
  __fx_admin_trade_submissions_inflight?: Map<string, Promise<TradeSubmissionsPayload>>;
};
if (!g.__fx_admin_trade_submissions_cache) g.__fx_admin_trade_submissions_cache = new Map();
if (!g.__fx_admin_trade_submissions_inflight) g.__fx_admin_trade_submissions_inflight = new Map();
const tradeSubmissionsCache = g.__fx_admin_trade_submissions_cache;
const tradeSubmissionsInflight = g.__fx_admin_trade_submissions_inflight;

const TypeParam = z.enum(["trade_log", "trade_strategy"]);
const CoachParam = z.string().trim().min(1).max(128);
const SUBMISSION_FIELD_SETS = [
  [
    "s.id,s.user_id,s.leader_id,s.type,s.status,s.rejection_reason,s.review_note,s.created_at,",
    "p.full_name as user_full_name,p.email as user_email,p.phone as user_phone"
  ].join(" "),
  [
    "s.id,s.user_id,s.leader_id,s.type,s.status,s.rejection_reason,s.review_note,s.created_at,",
    "p.full_name as user_full_name,p.email as user_email,null as user_phone"
  ].join(" "),
  [
    "s.id,s.user_id,s.leader_id,s.type,s.status,s.rejection_reason,s.review_note,s.created_at,",
    "null as user_full_name,null as user_email,null as user_phone"
  ].join(" ")
] as const;

function formatSupportLabel(row: { id?: string | null; full_name?: string | null; email?: string | null } | null | undefined) {
  if (!row) return null;
  const fullName = String(row.full_name || "").trim();
  if (fullName) return fullName;
  const email = String(row.email || "").trim();
  if (email) return email;
  const id = String(row.id || "").trim();
  return id ? id.slice(0, 6) : null;
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function sweepTradeSubmissionsCache(now: number) {
  if (!tradeSubmissionsCache.size) return;
  for (const [key, value] of tradeSubmissionsCache.entries()) {
    if (value.exp <= now) tradeSubmissionsCache.delete(key);
  }
  if (tradeSubmissionsCache.size <= CACHE_MAX_KEYS) return;
  const overflow = tradeSubmissionsCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of tradeSubmissionsCache.keys()) {
    tradeSubmissionsCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function findReusableTradeSubmissionsPayload(cacheKey: string) {
  const entry = tradeSubmissionsCache.get(cacheKey);
  if (!entry) return null;
  const now = Date.now();
  if (entry.exp > now) return entry.payload;
  if (entry.exp + STALE_GRACE_MS > now) return entry.payload;
  return null;
}

export async function GET(req: NextRequest) {
  let cacheKeyForFallback = "";
  let fallbackPage = 1;
  let fallbackPageSize = 20;
  try {
    const { user } = await requireManager();
    const typeRaw = req.nextUrl.searchParams.get("type") || "";
    const parsedType = TypeParam.safeParse(typeRaw);
    if (!parsedType.success) return json({ ok: false, error: "INVALID_TYPE" }, 400);
    const type = parsedType.data;
    const tradeLogCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const coachRaw = (req.nextUrl.searchParams.get("coachId") || "").trim();
    const parsedCoach = coachRaw ? CoachParam.safeParse(coachRaw) : null;
    if (coachRaw && !parsedCoach?.success) return json({ ok: false, error: "INVALID_COACH" }, 400);
    const coachId = parsedCoach?.success ? parsedCoach.data : "";

    const { page, pageSize, from } = getPagination(req, { defaultPageSize: 20, maxPageSize: 200 });
    fallbackPage = page;
    fallbackPageSize = pageSize;
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";

    if (coachId) {
      if (user.role === "assistant") return json({ ok: false, error: "FORBIDDEN" }, 403);
      if (user.role === "coach" && coachId !== user.id) return json({ ok: false, error: "FORBIDDEN" }, 403);
      if (user.role === "leader") {
        const treeIds = await fetchLeaderTreeIds(user.id);
        if (!treeIds.includes(coachId)) return json({ ok: false, error: "FORBIDDEN" }, 403);
      }
    } else if (user.role === "leader") {
      // scope set below
    } else if (user.role === "coach") {
      // scope set below
    } else if (user.role === "assistant") {
      // scope set below
    }

    let scopeIds: string[] | null = null;
    if (coachId) {
      scopeIds = (await dbAll<{ assigned_user_id: string | null }>(
        "select assigned_user_id from coach_assignments where coach_id = ?",
        [coachId]
      )).map((row) => String(row.assigned_user_id || "")).filter(Boolean);
    } else if (user.role === "leader") {
      scopeIds = await fetchLeaderTreeIds(user.id);
    } else if (user.role === "coach") {
      scopeIds = await fetchCoachAssignedUserIds(user.id);
    } else if (user.role === "assistant") {
      scopeIds = await fetchAssistantCreatedUserIds(user.id);
    }

    if (scopeIds && !scopeIds.length) {
      return json({ ok: true, items: [], page, pageSize, total: 0, pendingTotal: 0 });
    }

    const where: string[] = ["s.type = ?", "s.archived_at is null"];
    const params: unknown[] = [type];
    if (type === "trade_log") {
      where.push("s.created_at >= ?");
      params.push(tradeLogCutoff);
    }
    if (scopeIds) {
      const scopedFilter = buildSqlInFilter("s.user_id", scopeIds);
      if (scopedFilter.sql) {
        where.push(scopedFilter.sql);
        params.push(...scopedFilter.params);
      }
    }
    const whereSql = where.length ? `where ${where.join(" and ")}` : "";
    const pendingWhereSql = `where ${[...where, "s.status = ?"].join(" and ")}`;
    const pendingParams: unknown[] = [...params, "submitted"];
    const cacheKey = `${user.id}:${user.role}:${type}:${coachId}:${page}:${pageSize}:${from}`;
    cacheKeyForFallback = cacheKey;
    if (!fresh) {
      const now = Date.now();
      sweepTradeSubmissionsCache(now);
      const cached = tradeSubmissionsCache.get(cacheKey);
      if (cached && cached.exp > now) {
        return json(cached.payload);
      }
    }

    let task: Promise<TradeSubmissionsPayload> | undefined = fresh
      ? undefined
      : tradeSubmissionsInflight.get(cacheKey);
    if (!task) {
      task = (async (): Promise<TradeSubmissionsPayload> => {
        let submissions: any[] = [];
        const pendingRow = await dbFirst<{ total: number }>(
          `select count(1) as total from trade_submissions s ${pendingWhereSql}`,
          pendingParams
        );
        const pendingTotal = Number(pendingRow?.total || 0);
        for (const fields of SUBMISSION_FIELD_SETS) {
          try {
            submissions = await dbAll(
              [
                `select ${fields},`,
                "count(1) over() as __total",
                "from trade_submissions s",
                "left join profiles p on p.id = s.user_id",
                whereSql,
                "order by case when s.status = 'submitted' then 0 else 1 end, s.created_at desc",
                "limit ? offset ?"
              ].join(" "),
              [...params, pageSize, from]
            );
            break;
          } catch (error: any) {
            const message = String(error?.message || "").toLowerCase();
            if (!message.includes("no such column")) throw error;
          }
        }

        let total = Number((submissions || [])[0]?.__total || 0);
        if (!(submissions || []).length && from > 0) {
          const countRow = await dbFirst<{ total: number }>(
            `select count(1) as total from trade_submissions s ${whereSql}`,
            params
          );
          total = Number(countRow?.total || 0);
        }
        if (!total) {
          return { ok: true, items: [], page, pageSize, total: 0, pendingTotal };
        }

        const normalizedSubmissions = (submissions || []).map((row: any) => {
          const copy = { ...row };
          delete copy.__total;
          return copy;
        });
        const ids = normalizedSubmissions.map((s: any) => s.id);
        const leaderIds = Array.from(
          new Set(normalizedSubmissions.map((s: any) => String(s.leader_id || "")).filter(Boolean))
        );
        const [files, supportMap] = await Promise.all([
          ids.length
            ? dbAll(
                `select id,submission_id,file_name,mime_type,size_bytes,storage_bucket,storage_path from trade_submission_files where submission_id in (${sqlPlaceholders(
                  ids.length
                )})`,
                ids
              )
            : Promise.resolve([] as any[]),
          fetchStudentSupportNames(
            Array.from(new Set(normalizedSubmissions.map((s: any) => String(s.user_id || "")).filter(Boolean)))
          )
        ]);
        const leaderProfiles = leaderIds.length
          ? await dbAll<{ id: string | null; full_name: string | null; email: string | null }>(
              `select id,full_name,email from profiles where id in (${sqlPlaceholders(leaderIds.length)})`,
              leaderIds
            )
          : [];
        const leaderNameById = new Map<string, string>();
        (leaderProfiles || []).forEach((row) => {
          const id = String(row.id || "").trim();
          const label = formatSupportLabel(row);
          if (id && label) leaderNameById.set(id, label);
        });

        const filesBySubmission = new Map<string, any[]>();
        (files || []).forEach((f: any) => {
          const list = filesBySubmission.get(f.submission_id) || [];
          list.push(f);
          filesBySubmission.set(f.submission_id, list);
        });

        const items = normalizedSubmissions.map((s: any) => {
          const list = filesBySubmission.get(s.id) || [];
          const nextFiles = list.map((f) => ({
            id: f.id,
            file_name: f.file_name,
            mime_type: f.mime_type || null,
            size_bytes: f.size_bytes || 0,
            url: f.id ? `/api/system/trade-submission-files/${f.id}/download?disposition=inline` : null
          }));
          const support = supportMap.get(String(s.user_id || "")) || null;
          const fallbackLeaderName = leaderNameById.get(String(s.leader_id || "").trim()) || null;
          const assistantName = support?.assistantName || fallbackLeaderName;
          const coachName = support?.coachName || null;
          return {
            ...s,
            files: nextFiles,
            support_name: coachName || assistantName,
            assistant_name: assistantName,
            coach_name: coachName,
            user: s.user_id
              ? {
                  id: s.user_id,
                  full_name: s.user_full_name ?? null,
                  email: s.user_email ?? null,
                  phone: s.user_phone ?? null
                }
              : null
          };
        });
        return { ok: true, items, page, pageSize, total, pendingTotal };
      })();
      if (!fresh) tradeSubmissionsInflight.set(cacheKey, task);
    }
    try {
      const payload = await task;
      if (!fresh) {
        tradeSubmissionsCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
      }
      return json(payload);
    } finally {
      if (!fresh) tradeSubmissionsInflight.delete(cacheKey);
    }
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    if (mapped.code === "UNAUTHORIZED" || mapped.code === "FORBIDDEN" || mapped.code === "FROZEN") {
      return json({ ok: false, error: mapped.code }, mapped.status);
    }
    if (cacheKeyForFallback) {
      const cached = findReusableTradeSubmissionsPayload(cacheKeyForFallback);
      if (cached) return json({ ...cached, transient: true });
    }
    return json({
      ok: true,
      items: [],
      page: fallbackPage,
      pageSize: fallbackPageSize,
      total: 0,
      pendingTotal: 0,
      transient: true
    });
  }
}



