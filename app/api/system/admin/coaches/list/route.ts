import { NextRequest, NextResponse } from "next/server";

import { buildSqlInFilter, dbAll, dbFirst } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { getPagination } from "@/lib/system/pagination";
import { isMissingSchemaError, toSchemaWarning } from "@/lib/system/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 8_000;
const CACHE_MAX_KEYS = 2000;
type CoachesListPayload = {
  ok: true;
  items: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
  schemaWarning?: string;
};
const g = globalThis as {
  __fx_admin_coaches_list_cache?: Map<string, { exp: number; payload: CoachesListPayload }>;
  __fx_admin_coaches_list_inflight?: Map<string, Promise<CoachesListPayload>>;
};
if (!g.__fx_admin_coaches_list_cache) g.__fx_admin_coaches_list_cache = new Map();
if (!g.__fx_admin_coaches_list_inflight) g.__fx_admin_coaches_list_inflight = new Map();
const coachesListCache = g.__fx_admin_coaches_list_cache;
const coachesListInflight = g.__fx_admin_coaches_list_inflight;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" }
  });
}

function sweepCoachesListCache(now: number) {
  if (!coachesListCache.size) return;
  for (const [key, value] of coachesListCache.entries()) {
    if (value.exp <= now) coachesListCache.delete(key);
  }
  if (coachesListCache.size <= CACHE_MAX_KEYS) return;
  const overflow = coachesListCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of coachesListCache.keys()) {
    coachesListCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

const COACH_ROW_SELECT_CANDIDATES = [
  "id,full_name,email,phone,leader_id,created_at,last_login_at,status",
  "id,full_name,email,phone,leader_id,created_at,status",
  "id,full_name,email,phone,leader_id,status",
  "id,email,leader_id,status"
] as const;

const COACH_ORDER_CANDIDATES = ["created_at", "id"] as const;

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAdmin();
    const isSuper = user.role === "super_admin";
    const { page, pageSize, from } = getPagination(req, { defaultPageSize: 50, maxPageSize: 200 });
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const limit = pageSize;
    const offset = from;

    let coachIdsFilter: string[] | null = null;
    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      const filtered = treeIds.filter((id) => id && id !== user.id);
      if (!filtered.length) return json({ ok: true, items: [], page, pageSize, total: 0 });
      coachIdsFilter = filtered;
    }
    const coachScopeFilter = buildSqlInFilter("id", coachIdsFilter);
    const cacheKey = `${user.id}:${user.role}:${page}:${pageSize}:${offset}`;
    if (!fresh) {
      const now = Date.now();
      sweepCoachesListCache(now);
      const cached = coachesListCache.get(cacheKey);
      if (cached && cached.exp > now) {
        return json(cached.payload);
      }
    }

    let task = coachesListInflight.get(cacheKey);
    if (!task) {
      task = (async (): Promise<CoachesListPayload> => {
        let selectedColumns = "";
        let data: any[] = [];
        let listErr: any = null;

        for (const columns of COACH_ROW_SELECT_CANDIDATES) {
          for (const orderColumn of COACH_ORDER_CANDIDATES) {
            const listSqlBase = `select ${columns}, count(1) over() as __total from profiles where role = ?`;
            const listParams: unknown[] = ["coach", ...coachScopeFilter.params, limit, offset];
            const listSql = `${listSqlBase}${
              coachScopeFilter.sql ? ` and ${coachScopeFilter.sql}` : ""
            } order by ${orderColumn} desc limit ? offset ?`;

            try {
              data = await dbAll<any>(listSql, listParams);
              selectedColumns = columns;
              listErr = null;
              break;
            } catch (error) {
              if (isMissingSchemaError(error)) {
                listErr = error;
                continue;
              }
              listErr = error;
              break;
            }
          }
          if (!listErr && selectedColumns) break;
          if (listErr && !isMissingSchemaError(listErr)) break;
        }

        if (listErr) {
          if (isMissingSchemaError(listErr)) {
            return {
              ok: true,
              items: [],
              page,
              pageSize,
              total: 0,
              schemaWarning: toSchemaWarning(listErr)
            };
          }
          throw listErr;
        }

        let total = Number((data || [])[0]?.__total || 0);
        if (!(data || []).length && offset > 0) {
          const countSqlBase = "select count(1) as total from profiles where role = ?";
          const countParams: unknown[] = ["coach", ...coachScopeFilter.params];
          const countSql = `${countSqlBase}${coachScopeFilter.sql ? ` and ${coachScopeFilter.sql}` : ""}`;
          try {
            const countRow = await dbFirst<{ total: number }>(countSql, countParams);
            total = Number(countRow?.total || 0);
          } catch (error) {
            if (!isMissingSchemaError(error)) throw error;
            return {
              ok: true,
              items: [],
              page,
              pageSize,
              total: 0,
              schemaWarning: toSchemaWarning(error)
            };
          }
        }

        const normalizedData = (data || []).map((row: any) => {
          const copy = { ...row };
          delete copy.__total;
          return copy;
        });
        const coachIds = normalizedData.map((row) => row.id).filter(Boolean);
        let assignments: any[] = [];
        if (coachIds.length) {
          const assignmentFilter = buildSqlInFilter("coach_id", coachIds);
          try {
            assignments = await dbAll<any>(
              `select coach_id${isSuper ? ", assigned_user_id" : ""} from coach_assignments where ${assignmentFilter.sql}`,
              assignmentFilter.params
            );
          } catch (error) {
            if (!isMissingSchemaError(error)) throw error;
          }
        }

        const counts = new Map<string, number>();
        (assignments || []).forEach((row: any) => {
          const id = String(row.coach_id || "");
          if (!id) return;
          counts.set(id, (counts.get(id) || 0) + 1);
        });

        const managedLeadersByCoach = new Map<string, Set<string>>();
        if (isSuper && Array.isArray(assignments) && assignments.length) {
          const assignedUserIds = Array.from(
            new Set((assignments || []).map((row: any) => row.assigned_user_id).filter(Boolean))
          );
          let assignedUsers: any[] = [];
          if (assignedUserIds.length) {
            const assignedUsersFilter = buildSqlInFilter("id", assignedUserIds);
            try {
              assignedUsers = await dbAll<any>(
                `select id, leader_id from profiles where ${assignedUsersFilter.sql}`,
                assignedUsersFilter.params
              );
            } catch (error) {
              if (isMissingSchemaError(error)) {
                assignedUsers = await dbAll<any>(
                  `select id, null as leader_id from profiles where ${assignedUsersFilter.sql}`,
                  assignedUsersFilter.params
                );
              } else {
                throw error;
              }
            }
          }
          const leaderByUserId = new Map<string, string | null>(
            (assignedUsers || []).map((row: any) => [
              String(row.id),
              row.leader_id ? String(row.leader_id) : null
            ])
          );
          (assignments || []).forEach((row: any) => {
            const coachId = String(row.coach_id || "");
            const assignedId = String(row.assigned_user_id || "");
            if (!coachId || !assignedId) return;
            const leaderId = leaderByUserId.get(assignedId);
            if (typeof leaderId !== "string" || !leaderId) return;
            const set = managedLeadersByCoach.get(coachId) || new Set<string>();
            set.add(leaderId);
            managedLeadersByCoach.set(coachId, set);
          });
        }

        const leaderIds = Array.from(
          new Set(normalizedData.map((row: any) => row.leader_id).filter(Boolean))
        ) as string[];
        let leaders: any[] = [];
        if (leaderIds.length) {
          const leaderFilter = buildSqlInFilter("id", leaderIds);
          try {
            leaders = await dbAll<any>(
              `select id, full_name, email from profiles where ${leaderFilter.sql}`,
              leaderFilter.params
            );
          } catch (error) {
            if (isMissingSchemaError(error)) {
              try {
                leaders = await dbAll<any>(
                  `select id, null as full_name, email from profiles where ${leaderFilter.sql}`,
                  leaderFilter.params
                );
              } catch (fallbackError) {
                if (!isMissingSchemaError(fallbackError)) throw fallbackError;
                leaders = await dbAll<any>(
                  `select id, null as full_name, null as email from profiles where ${leaderFilter.sql}`,
                  leaderFilter.params
                );
              }
            } else {
              throw error;
            }
          }
        }
        const leadersById = new Map((leaders || []).map((row: any) => [row.id, row]));

        const items = normalizedData.map((row: any) => ({
          ...row,
          full_name: selectedColumns.includes("full_name") ? row.full_name || null : null,
          email: selectedColumns.includes("email") ? row.email || null : null,
          phone: selectedColumns.includes("phone") ? row.phone || null : null,
          created_at: selectedColumns.includes("created_at") ? row.created_at || null : null,
          last_login_at: selectedColumns.includes("last_login_at") ? row.last_login_at || null : null,
          status: selectedColumns.includes("status") ? row.status || "active" : "active",
          leader: row.leader_id ? leadersById.get(row.leader_id) || null : null,
          assigned_count: counts.get(row.id) || 0,
          managed_leader_ids: isSuper ? Array.from(managedLeadersByCoach.get(row.id) || []) : undefined
        }));

        return { ok: true, items, page, pageSize, total };
      })();
      coachesListInflight.set(cacheKey, task);
    }
    try {
      const payload = await task;
      if (!fresh) {
        coachesListCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
      }
      return json(payload);
    } finally {
      coachesListInflight.delete(cacheKey);
    }
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}

