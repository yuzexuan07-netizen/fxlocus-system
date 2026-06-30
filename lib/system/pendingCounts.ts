import { dbAll, dbFirst, sqlPlaceholders } from "@/lib/d1";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { buildSqlInFilter } from "@/lib/d1";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import {
  countUnreadContactSubmissionsByReadMarks,
  ensureAdminRecordReadMarksTable,
  getAdminRecordReadMarkMap,
  resolveAdminRecordReadAt
} from "@/lib/system/adminRecordReadMarks";

type PendingCounts = {
  courseAccess: number;
  fileAccess: number;
  tradeLogs: number;
  tradeStrategies: number;
  classicTrades: number;
  weeklySummaries: number;
  weeklySummariesStudent: number;
  weeklySummariesAssistant: number;
  weeklySummariesLeader: number;
  courseSummaries: number;
  ladderRequests: number;
  studentDocuments: number;
  enrollments: number;
  contacts: number;
  donations: number;
};

const CACHE_TTL_MS = 20_000;
const CACHE_MAX_KEYS = 480;
const g = globalThis as {
  __fx_pending_counts_cache?: Map<string, { exp: number; value: { counts: PendingCounts; warnings?: string[] } }>;
  __fx_pending_counts_inflight?: Map<string, Promise<{ counts: PendingCounts; warnings?: string[] }>>;
};
if (!g.__fx_pending_counts_cache) g.__fx_pending_counts_cache = new Map();
if (!g.__fx_pending_counts_inflight) g.__fx_pending_counts_inflight = new Map();
const pendingCache = g.__fx_pending_counts_cache;
const pendingInflight = g.__fx_pending_counts_inflight;

function sweepPendingCache(now: number) {
  if (!pendingCache.size) return;
  for (const [key, value] of pendingCache.entries()) {
    if (value.exp <= now) pendingCache.delete(key);
  }
  if (pendingCache.size <= CACHE_MAX_KEYS) return;
  const overflow = pendingCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of pendingCache.keys()) {
    pendingCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function normalizeError(err: any) {
  return String(err?.message || err?.error_description || err?.hint || err?.code || "") || "query_failed";
}

function buildInClause(field: string, ids: string[] | null) {
  if (!ids || ids.length === 0) return { sql: "", params: [] as unknown[] };
  if (ids.length <= 50) {
    return {
      sql: ` and ${field} in (${sqlPlaceholders(ids.length)})`,
      params: ids
    };
  }
  const filter = buildSqlInFilter(field, ids);
  if (!filter.sql) return { sql: "", params: [] as unknown[] };
  return {
    sql: ` and ${filter.sql}`,
    params: filter.params
  };
}

async function countRows(sql: string, params: unknown[] = []) {
  const row = await dbFirst<{ total: number }>(`select count(1) as total ${sql}`, params);
  return Number(row?.total || 0);
}

async function countDistinct(field: string, sql: string, params: unknown[] = []) {
  const row = await dbFirst<{ total: number }>(`select count(distinct ${field}) as total ${sql}`, params);
  return Number(row?.total || 0);
}

function isMissingSchemaError(err: any) {
  const message = String(err?.message || "").toLowerCase();
  return message.includes("no such table") || message.includes("no such column");
}

async function countUnreadRecordsByType(recordType: "donate" | "contact" | "enrollment") {
  try {
    await ensureAdminRecordReadMarksTable();
    const countRow = await dbFirst<{ total: number }>(
      [
        "select count(1) as total from records r",
        "left join admin_record_read_marks m",
        "on m.record_type = ? and m.record_id = r.id",
        "where r.type = ?",
        "and coalesce(",
        "r.read_at,",
        "m.read_at,",
        "case when json_valid(r.payload) then json_extract(r.payload, '$.read_at') end,",
        "case when json_valid(r.payload) then json_extract(r.payload, '$.readAt') end,",
        "case when json_valid(r.content) then json_extract(r.content, '$.read_at') end,",
        "case when json_valid(r.content) then json_extract(r.content, '$.readAt') end",
        ") is null"
      ].join(" "),
      [recordType, recordType]
    );
    return Number(countRow?.total || 0);
  } catch (err: any) {
    const message = String(err?.message || "").toLowerCase();
    if (message.includes("no such table")) {
      if (recordType === "contact") {
        return await countUnreadContactSubmissionsByReadMarks();
      }
      return 0;
    }
    if (!message.includes("no such column") && !message.includes("no such function")) throw err;

    const rows = await dbAll<{ id: string; read_at?: string | null; payload?: string | null; content?: string | null }>(
      "select id, read_at, payload, content from records where type = ? order by created_at desc limit 5000",
      [recordType]
    );
    if (!rows.length) return 0;
    const marks = await getAdminRecordReadMarkMap(
      recordType,
      rows.map((row) => row.id)
    );
    return rows.filter((row) => {
      const id = String(row.id || "");
      const markReadAt = id ? marks.get(id) || null : null;
      return !resolveAdminRecordReadAt(row as any, markReadAt);
    }).length;
  }
}

export async function getPendingCounts({
  user,
  bypassCache = false
}: {
  user: { id: string; role: string };
  bypassCache?: boolean;
}): Promise<{ counts: PendingCounts; warnings?: string[] }> {
  const cacheKey = `${user.id}:${user.role}`;
  const now = Date.now();
  if (!bypassCache) {
    sweepPendingCache(now);
    const cached = pendingCache.get(cacheKey);
    if (cached && cached.exp > now) {
      return cached.value;
    }
    const inflight = pendingInflight.get(cacheKey);
    if (inflight) {
      return await inflight;
    }
  }
  const compute = async () => {
    const counts: PendingCounts = {
      courseAccess: 0,
      fileAccess: 0,
      tradeLogs: 0,
      tradeStrategies: 0,
      classicTrades: 0,
      weeklySummaries: 0,
      weeklySummariesStudent: 0,
      weeklySummariesAssistant: 0,
      weeklySummariesLeader: 0,
      courseSummaries: 0,
      ladderRequests: 0,
      studentDocuments: 0,
      enrollments: 0,
      contacts: 0,
      donations: 0
    };

    const warnings: string[] = [];
    const warn = (key: string, err: any) => {
      warnings.push(`${key}:${normalizeError(err)}`);
    };

    let scopeIds: string[] | null = null;
    try {
      scopeIds =
        user.role === "leader"
          ? await fetchLeaderTreeIds(user.id)
          : user.role === "coach"
            ? await fetchCoachAssignedUserIds(user.id)
            : user.role === "assistant"
              ? await fetchAssistantCreatedUserIds(user.id)
              : null;
    } catch (err) {
      warn("scope", err);
      scopeIds = null;
    }

    if (scopeIds && scopeIds.length === 0) {
      const result = { counts, warnings: warnings.length ? warnings : undefined };
      if (!bypassCache) pendingCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, value: result });
      return result;
    }

    const safe = async <T>(key: string, fallback: T, fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch (err) {
        warn(key, err);
        return fallback;
      }
    };

    counts.courseAccess = await safe("course_access", 0, async () => {
      const scope = buildInClause("p.id", scopeIds);
      return countRows(
        `from course_access ca join profiles p on p.id = ca.user_id
         where ca.status = ? and p.role in ('student','trader','coach')${scope.sql}`,
        ["requested", ...scope.params]
      );
    });

    counts.fileAccess = await safe("file_access", 0, async () => {
      const scope = buildInClause("p.id", scopeIds);
      return countRows(
        `from file_access_requests r join profiles p on p.id = r.user_id
         where r.status = ?${scope.sql}`,
        ["requested", ...scope.params]
      );
    });

    const tradeScope = buildInClause("user_id", scopeIds);
    const tradeLogCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const tradeCounts = await safe(
      "trade_submissions",
      { logs: 0, strategies: 0 },
      async () => {
        const row = await dbFirst<{ logs: number | null; strategies: number | null }>(
          [
            "select",
            "sum(case when type = 'trade_log' and created_at >= ? then 1 else 0 end) as logs,",
            "sum(case when type = 'trade_strategy' then 1 else 0 end) as strategies",
            "from trade_submissions",
            "where status = ? and archived_at is null",
            `${tradeScope.sql}`
          ].join(" "),
          [tradeLogCutoff, "submitted", ...tradeScope.params]
        );
        return {
          logs: Number(row?.logs || 0),
          strategies: Number(row?.strategies || 0)
        };
      }
    );
    counts.tradeLogs = tradeCounts.logs;
    counts.tradeStrategies = tradeCounts.strategies;

    counts.classicTrades = await safe("classic_trades", 0, async () => {
      const scope = buildInClause("user_id", scopeIds);
      return countRows(`from classic_trades where reviewed_at is null${scope.sql}`, scope.params);
    });

    const weeklyScope = buildInClause("w.user_id", scopeIds);
    const weeklyRoles = await safe("weekly_roles", [] as Array<{ role: string | null; total: number }>, async () =>
      dbAll<{ role: string | null; total: number }>(
        `select p.role as role, count(1) as total
         from weekly_summaries w
         join profiles p on p.id = w.user_id
         where w.reviewed_at is null${weeklyScope.sql}
         group by p.role`,
        weeklyScope.params
      )
    );

    let weeklyTotal = 0;
    weeklyRoles.forEach((row) => {
      const role = String(row.role || "");
      const total = Number(row.total || 0);
      weeklyTotal += total;
      if (role === "assistant") counts.weeklySummariesAssistant += total;
      else if (role === "leader") counts.weeklySummariesLeader += total;
      else if (role === "student" || role === "trader") counts.weeklySummariesStudent += total;
    });
    counts.weeklySummaries = weeklyTotal;

    counts.courseSummaries = await safe("course_notes", 0, async () => {
      const scope = buildInClause("user_id", scopeIds);
      return countRows(
        `from course_notes where reviewed_at is null and submitted_at is not null${scope.sql}`,
        scope.params
      );
    });

    counts.ladderRequests = await safe("ladder_requests", 0, async () => {
      const scope = buildInClause("user_id", scopeIds);
      return countRows(`from ladder_authorizations where status = 'requested'${scope.sql}`, scope.params);
    });

    counts.studentDocuments = await safe("student_documents", 0, async () => {
      const scope = buildInClause("student_id", scopeIds);
      return countDistinct(
        "student_id",
        `from student_documents where reviewed_at is null${scope.sql}`,
        scope.params
      );
    });

    if (user.role === "super_admin") {
      counts.enrollments = await safe("enrollments", 0, async () => countUnreadRecordsByType("enrollment"));
      counts.donations = await safe("donations", 0, async () => countUnreadRecordsByType("donate"));
      counts.contacts = await safe("contacts", 0, async () => countUnreadRecordsByType("contact"));
    }

    const result = { counts, warnings: warnings.length ? warnings : undefined };
    if (!bypassCache) pendingCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, value: result });
    return result;
  };

  if (bypassCache) {
    return await compute();
  }

  const task = compute();
  pendingInflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    pendingInflight.delete(cacheKey);
  }
}
