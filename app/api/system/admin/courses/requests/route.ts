import { NextRequest, NextResponse } from "next/server";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { fetchStudentSupportNames } from "@/lib/system/studentSupport";
import { dbAll, sqlPlaceholders } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 20_000;
const CACHE_MAX_KEYS = 480;
const STALE_GRACE_MS = 90_000;
type CourseRequestsPayload = { ok: true; items: Array<Record<string, unknown>> };
const g = globalThis as {
  __fx_admin_course_requests_cache?: Map<string, { exp: number; payload: CourseRequestsPayload }>;
  __fx_admin_course_requests_inflight?: Map<string, Promise<CourseRequestsPayload>>;
};
if (!g.__fx_admin_course_requests_cache) g.__fx_admin_course_requests_cache = new Map();
if (!g.__fx_admin_course_requests_inflight) g.__fx_admin_course_requests_inflight = new Map();
const courseRequestsCache = g.__fx_admin_course_requests_cache;
const courseRequestsInflight = g.__fx_admin_course_requests_inflight;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function sweepCourseRequestsCache(now: number) {
  if (!courseRequestsCache.size) return;
  for (const [key, value] of courseRequestsCache.entries()) {
    if (value.exp <= now) courseRequestsCache.delete(key);
  }
  if (courseRequestsCache.size <= CACHE_MAX_KEYS) return;
  const overflow = courseRequestsCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of courseRequestsCache.keys()) {
    courseRequestsCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function findReusableCourseRequestsPayload(cacheKey: string) {
  const entry = courseRequestsCache.get(cacheKey);
  if (!entry) return null;
  const now = Date.now();
  if (entry.exp > now) return entry.payload;
  if (entry.exp + STALE_GRACE_MS > now) return entry.payload;
  return null;
}

export async function GET(req: NextRequest) {
  let cacheKeyForFallback = "";
  try {
    const { user } = await requireManager();
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const cacheKey = `${user.id}:${user.role}`;
    cacheKeyForFallback = cacheKey;
    const buildPayload = async (): Promise<CourseRequestsPayload> => {
    const learnerRoles = ["student", "trader", "coach"];

    const rows = await dbAll(
      "select id,user_id,course_id,status,requested_at from course_access where status = ? order by requested_at desc limit 300",
      ["requested"]
    );
    const userIds = Array.from(new Set(rows.map((r: any) => String(r.user_id)).filter(Boolean)));

    let scopedUserIds = userIds;
    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      const treeSet = new Set(treeIds);
      scopedUserIds = userIds.filter((id) => treeSet.has(id));
      if (!scopedUserIds.length) return { ok: true, items: [] };
    } else if (user.role === "coach") {
      const assignedIds = await fetchCoachAssignedUserIds(user.id);
      const assignedSet = new Set(assignedIds);
      scopedUserIds = userIds.filter((id) => assignedSet.has(id));
      if (!scopedUserIds.length) return { ok: true, items: [] };
    } else if (user.role === "assistant") {
      const createdIds = await fetchAssistantCreatedUserIds(user.id);
      const createdSet = new Set(createdIds);
      scopedUserIds = userIds.filter((id) => createdSet.has(id));
      if (!scopedUserIds.length) return { ok: true, items: [] };
    }

    type ProfileRow = {
      id: string;
      full_name: string | null;
      email: string | null;
      phone: string | null;
      role: string | null;
      support_name?: string | null;
      assistant_name?: string | null;
      coach_name?: string | null;
    };
    const users = scopedUserIds.length
      ? await dbAll<ProfileRow>(
          `select id,full_name,email,phone,role,leader_id from profiles where id in (${sqlPlaceholders(
            scopedUserIds.length
          )}) and role in (${sqlPlaceholders(learnerRoles.length)})`,
          [...scopedUserIds, ...learnerRoles]
        )
      : [];
    const usersById = new Map<string, ProfileRow>(users.map((u) => [u.id, u]));
    const filteredRows = rows.filter((r: any) => usersById.has(String(r.user_id)));
    const courseIds = Array.from(new Set(filteredRows.map((r: any) => Number(r.course_id)).filter(Boolean)));

    const courses = courseIds.length
      ? await dbAll(
          `select id,title_zh,title_en from courses where id in (${sqlPlaceholders(courseIds.length)})`,
          courseIds
        )
      : [];
    const coursesById = new Map((courses || []).map((c: any) => [c.id, c]));
    const supportMap = await fetchStudentSupportNames(scopedUserIds);

    const items = filteredRows.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      course_id: r.course_id,
      status: r.status,
      requested_at: r.requested_at,
      user: (() => {
        const base = usersById.get(r.user_id);
        if (!base) return null;
        const support = supportMap.get(String(r.user_id));
        return {
          ...base,
          support_name: support?.displayName || null,
          assistant_name: support?.assistantName || null,
          coach_name: support?.coachName || null
        };
      })(),
      course: coursesById.get(r.course_id) || null
    }));

      return { ok: true, items };
    };

    if (fresh) {
      const payload = await buildPayload();
      return json(payload);
    }

    const now = Date.now();
    sweepCourseRequestsCache(now);
    const cached = courseRequestsCache.get(cacheKey);
    if (cached && cached.exp > now) {
      return json(cached.payload);
    }

    let task = courseRequestsInflight.get(cacheKey);
    if (!task) {
      task = buildPayload();
      courseRequestsInflight.set(cacheKey, task);
    }

    try {
      const payload = await task;
      courseRequestsCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
      return json(payload);
    } finally {
      courseRequestsInflight.delete(cacheKey);
    }
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    if (mapped.code === "UNAUTHORIZED" || mapped.code === "FORBIDDEN" || mapped.code === "FROZEN") {
      return json({ ok: false, error: mapped.code }, mapped.status);
    }
    if (cacheKeyForFallback) {
      const cached = findReusableCourseRequestsPayload(cacheKeyForFallback);
      if (cached) return json({ ...cached, transient: true });
    }
    return json({ ok: true, items: [], transient: true });
  }
}



