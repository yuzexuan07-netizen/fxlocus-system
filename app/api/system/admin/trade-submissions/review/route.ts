import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { dbFirst, dbRun } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { invalidateSidebarCountsCache, invalidateTradeSubmissionsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  submissionId: z.string().trim().min(1).max(128),
  note: z.string().max(500).optional()
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireManager();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const submission = await dbFirst<{
      id: string;
      user_id: string;
      leader_id: string | null;
      type: string;
      status: string;
    }>(
      "select id,user_id,leader_id,type,status from trade_submissions where id = ? limit 1",
      [parsed.data.submissionId]
    );
    if (!submission?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
    if (submission.status !== "submitted") {
      return json({ ok: false, error: "ALREADY_REVIEWED" }, 400);
    }
    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      if (!treeIds.includes(submission.user_id)) {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }
    } else if (user.role === "coach") {
      const assignedIds = await fetchCoachAssignedUserIds(user.id);
      if (!assignedIds.includes(submission.user_id)) {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }
    } else if (user.role === "assistant") {
      const createdIds = await fetchAssistantCreatedUserIds(user.id);
      if (!createdIds.includes(submission.user_id)) {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }
    }

    const now = new Date().toISOString();
    const note = parsed.data.note?.trim() || null;
    try {
      await dbRun(
        "update trade_submissions set status = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ?, review_note = ?, rejection_reason = null where id = ?",
        ["approved", now, user.id, now, note, submission.id]
      );
    } catch {
      return json({ ok: false, error: "DB_ERROR" }, 500);
    }

    const title =
      submission.type === "trade_strategy"
        ? "模拟交易策略已阅 / Simulation strategy reviewed"
        : "模拟交易日志已阅 / Simulation trade log reviewed";
    const content =
      note && note.length
        ? `审批意见：${note}\n\nReview note: ${note}`
        : submission.type === "trade_strategy"
          ? "你的模拟交易策略已阅。\n\nYour simulation trade strategy has been reviewed."
          : "你的模拟交易日志已阅。\n\nYour simulation trade log has been reviewed.";

    try {
      await dbRun(
        "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
        [submission.user_id, user.id, title, content, now]
      );
    } catch {
      // ignore notify failures
    }

    invalidateTradeSubmissionsCache();
    invalidateSidebarCountsCache();

    return json({ ok: true });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}



