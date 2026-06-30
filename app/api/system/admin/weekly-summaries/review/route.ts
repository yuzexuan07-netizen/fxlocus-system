import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { dbFirst, dbRun } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { invalidateSidebarCountsCache, invalidateWeeklySummariesCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  entryId: z.string().trim().min(1).max(128),
  reviewNote: z.string().max(2000).optional().nullable()
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireManager();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const entry = await dbFirst<{ id: string; user_id: string | null }>(
      "select id, user_id from weekly_summaries where id = ? limit 1",
      [parsed.data.entryId]
    );
    if (!entry?.id || !entry.user_id) return json({ ok: false, error: "NOT_FOUND" }, 404);

    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      if (!treeIds.includes(entry.user_id)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    } else if (user.role === "coach") {
      const assignedIds = await fetchCoachAssignedUserIds(user.id);
      if (!assignedIds.includes(entry.user_id)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    } else if (user.role === "assistant") {
      const createdIds = await fetchAssistantCreatedUserIds(user.id);
      if (!createdIds.includes(entry.user_id)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const now = new Date().toISOString();
    const reviewNote = String(parsed.data.reviewNote || "").trim();
    await dbRun(
      "update weekly_summaries set reviewed_at = ?, reviewed_by = ?, review_note = ?, updated_at = ? where id = ?",
      [now, user.id, reviewNote || null, now, entry.id]
    );

    const title = reviewNote ? "Weekly summary replied" : "Weekly summary reviewed";
    const content = reviewNote
      ? `Your weekly summary review note: ${reviewNote}`
      : "Your weekly summary has been reviewed.";

    await dbRun(
      "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
      [entry.user_id, user.id, title, content, now]
    );

    invalidateWeeklySummariesCache();
    invalidateSidebarCountsCache();

    return json({ ok: true });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
