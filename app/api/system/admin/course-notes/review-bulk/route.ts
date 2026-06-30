import { NextRequest, NextResponse } from "next/server";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { buildSqlInFilter, dbAll, dbBatch, dbRun, sqlPlaceholders } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { invalidateCourseNotesCache, invalidateSidebarCountsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(_req: NextRequest) {
  try {
    const { user } = await requireManager();
    if (user.role === "coach") return json({ ok: false, error: "FORBIDDEN" }, 403);

    let scopeIds: string[] | null = null;
    if (user.role === "leader") {
      scopeIds = await fetchLeaderTreeIds(user.id);
    } else if (user.role === "assistant") {
      scopeIds = await fetchAssistantCreatedUserIds(user.id);
    }
    if (scopeIds && !scopeIds.length) return json({ ok: true, count: 0 });

    const where: string[] = ["reviewed_at is null", "submitted_at is not null"];
    const params: unknown[] = [];
    if (scopeIds) {
      const scopedFilter = buildSqlInFilter("user_id", scopeIds);
      if (scopedFilter.sql) {
        where.push(scopedFilter.sql);
        params.push(...scopedFilter.params);
      }
    }

    const rows = await dbAll<{ id: string; user_id: string; course_id: number | null }>(
      `select id, user_id, course_id from course_notes where ${where.join(" and ")} order by submitted_at desc limit 500`,
      params
    );
    const ids = rows.map((r) => r.id).filter(Boolean);
    if (!ids.length) return json({ ok: true, count: 0 });

    const now = new Date().toISOString();
    await dbRun(
      `update course_notes set reviewed_at = ?, reviewed_by = ?, review_note = null, updated_at = ? where id in (${sqlPlaceholders(
        ids.length
      )})`,
      [now, user.id, now, ...ids]
    );

    const notifications = rows.map((row) => ({
      sql: "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
      params: [
        row.user_id,
        user.id,
        "Course summary reviewed",
        `Lesson ${Number(row.course_id || 0)} summary reviewed.`,
        now
      ]
    }));
    if (notifications.length) {
      await dbBatch(notifications);
    }

    invalidateCourseNotesCache();
    invalidateSidebarCountsCache();

    return json({ ok: true, count: ids.length });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
