import { NextRequest, NextResponse } from "next/server";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { fetchStudentSupportNames } from "@/lib/system/studentSupport";
import { rewriteHtmlStorageUrlsToProxy } from "@/lib/storage/objectUrl";
import { buildSqlInFilter, dbAll, dbFirst } from "@/lib/d1";
import { getPagination } from "@/lib/system/pagination";
import { mapSystemApiError } from "@/lib/system/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 8_000;
const CACHE_MAX_KEYS = 2000;
type CourseNotesPayload = {
  ok: true;
  items: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
};
const g = globalThis as {
  __fx_admin_course_notes_cache?: Map<string, { exp: number; payload: CourseNotesPayload }>;
  __fx_admin_course_notes_inflight?: Map<string, Promise<CourseNotesPayload>>;
};
if (!g.__fx_admin_course_notes_cache) g.__fx_admin_course_notes_cache = new Map();
if (!g.__fx_admin_course_notes_inflight) g.__fx_admin_course_notes_inflight = new Map();
const courseNotesCache = g.__fx_admin_course_notes_cache;
const courseNotesInflight = g.__fx_admin_course_notes_inflight;

const NOTE_ROW_FIELD_SETS = [
  [
    "n.id, n.user_id, n.course_id, n.content_html, n.content_md, n.submitted_at, n.reviewed_at, n.reviewed_by, n.review_note, n.updated_at,",
    "p.full_name as user_full_name, p.email as user_email, p.phone as user_phone, p.leader_id as user_leader_id"
  ].join(" "),
  [
    "n.id, n.user_id, n.course_id, n.content_html, n.content_md, n.submitted_at, n.reviewed_at, n.reviewed_by, n.review_note, n.updated_at,",
    "p.full_name as user_full_name, p.email as user_email, null as user_phone, null as user_leader_id"
  ].join(" "),
  [
    "n.id, n.user_id, n.course_id, n.content_html, n.content_md, n.submitted_at, n.reviewed_at, n.reviewed_by, n.review_note, n.updated_at,",
    "null as user_full_name, null as user_email, null as user_phone, null as user_leader_id"
  ].join(" ")
] as const;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" }
  });
}

function sweepCourseNotesCache(now: number) {
  if (!courseNotesCache.size) return;
  for (const [key, value] of courseNotesCache.entries()) {
    if (value.exp <= now) courseNotesCache.delete(key);
  }
  if (courseNotesCache.size <= CACHE_MAX_KEYS) return;
  const overflow = courseNotesCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of courseNotesCache.keys()) {
    courseNotesCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

async function fetchNoteRows(whereSql: string, params: unknown[], pageSize: number, from: number) {
  for (const fields of NOTE_ROW_FIELD_SETS) {
    try {
      return await dbAll(
        [
          `select ${fields},`,
          "count(1) over() as __total",
          "from course_notes n",
          "left join profiles p on p.id = n.user_id",
          whereSql,
          "order by case when n.reviewed_at is null then 0 else 1 end asc, n.submitted_at desc",
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

    if (scopeIds && !scopeIds.length) {
      return json({ ok: true, items: [], page, pageSize, total: 0 });
    }

    const where: string[] = ["n.submitted_at is not null"];
    const params: unknown[] = [];
    if (scopeIds) {
      const scopedFilter = buildSqlInFilter("n.user_id", scopeIds);
      if (scopedFilter.sql) {
        where.push(scopedFilter.sql);
        params.push(...scopedFilter.params);
      }
    }
    const whereSql = where.length ? `where ${where.join(" and ")}` : "";
    const cacheKey = `${user.id}:${user.role}:${leaderId}:${page}:${pageSize}:${from}`;
    if (!fresh) {
      const now = Date.now();
      sweepCourseNotesCache(now);
      const cached = courseNotesCache.get(cacheKey);
      if (cached && cached.exp > now) {
        return json(cached.payload);
      }
    }

    let task = courseNotesInflight.get(cacheKey);
    if (!task) {
      task = (async (): Promise<CourseNotesPayload> => {
        const notes = await fetchNoteRows(whereSql, params, pageSize, from);
        let total = Number((notes || [])[0]?.__total || 0);
        if (!(notes || []).length && from > 0) {
          const countRow = await dbFirst<{ total: number }>(
            `select count(1) as total from course_notes n ${whereSql}`,
            params
          );
          total = Number(countRow?.total || 0);
        }
        if (!total) return { ok: true, items: [], page, pageSize, total: 0 };

        const rows = (notes || []).map((row: any) => {
          const copy = { ...row };
          delete copy.__total;
          return copy;
        });
        const userIds = Array.from(new Set(rows.map((row: any) => String(row.user_id || "")).filter(Boolean)));
        const supportMap = userIds.length ? await fetchStudentSupportNames(userIds) : new Map();

        const items = rows.map((row: any) => {
          const baseUser = row.user_id
            ? {
                id: row.user_id,
                full_name: row.user_full_name ?? null,
                email: row.user_email ?? null,
                phone: row.user_phone ?? null,
                leader_id: row.user_leader_id ?? null
              }
            : null;
          const support = baseUser ? supportMap.get(String(row.user_id || "")) : null;
          const userPayload = baseUser
            ? {
                ...baseUser,
                support_name: support?.displayName || null,
                assistant_name: support?.assistantName || null,
                coach_name: support?.coachName || null
              }
            : null;
          const normalizedHtml = rewriteHtmlStorageUrlsToProxy(String(row.content_html || ""));
          return {
            ...row,
            content_html: normalizedHtml || row.content_html || null,
            user: userPayload
          };
        });

        return { ok: true, items, page, pageSize, total };
      })();
      courseNotesInflight.set(cacheKey, task);
    }
    try {
      const payload = await task;
      if (!fresh) {
        courseNotesCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
      }
      return json(payload);
    } finally {
      courseNotesInflight.delete(cacheKey);
    }
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
