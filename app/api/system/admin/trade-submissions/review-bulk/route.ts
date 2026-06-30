import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { buildSqlInFilter, dbAll, dbBatch, dbRun, sqlPlaceholders } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { invalidateSidebarCountsCache, invalidateTradeSubmissionsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  type: z.enum(["trade_log", "trade_strategy"]),
  coachId: z.string().trim().min(1).max(128).optional().nullable()
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireManager();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const { type, coachId } = parsed.data;

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
    }

    if (scopeIds && !scopeIds.length) return json({ ok: true, count: 0 });

    const where: string[] = ["status = ?", "type = ?", "archived_at is null"];
    const params: unknown[] = ["submitted", type];
    if (scopeIds) {
      const scopedFilter = buildSqlInFilter("user_id", scopeIds);
      if (scopedFilter.sql) {
        where.push(scopedFilter.sql);
        params.push(...scopedFilter.params);
      }
    }

    const rows = await dbAll<{ id: string; user_id: string }>(
      `select id, user_id from trade_submissions where ${where.join(" and ")} order by created_at desc limit 500`,
      params
    );
    const ids = (rows || []).map((r) => r.id).filter(Boolean);
    if (!ids.length) return json({ ok: true, count: 0 });

    const now = new Date().toISOString();
    await dbRun(
      `update trade_submissions set status = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ?, review_note = null, rejection_reason = null where id in (${sqlPlaceholders(
        ids.length
      )})`,
      ["approved", now, user.id, now, ...ids]
    );

    const title =
      type === "trade_strategy"
        ? "模拟交易策略已阅 / Simulation strategy reviewed"
        : "模拟交易日志已阅 / Simulation trade log reviewed";
    const content =
      type === "trade_strategy"
        ? "你的模拟交易策略已阅。\n\nYour simulation trade strategy has been reviewed."
        : "你的模拟交易日志已阅。\n\nYour simulation trade log has been reviewed.";

    const notifications = rows.map((row) => ({
      sql: "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
      params: [row.user_id, user.id, title, content, now]
    }));
    if (notifications.length) {
      await dbBatch(notifications);
    }

    invalidateTradeSubmissionsCache();
    invalidateSidebarCountsCache();

    return json({ ok: true, count: ids.length });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
