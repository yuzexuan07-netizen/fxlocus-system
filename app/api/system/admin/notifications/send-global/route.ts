import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { createD1TextId } from "@/lib/system/d1Id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  title: z.string().min(1).max(80),
  content: z.string().min(1).max(2000),
  pinned: z.boolean().optional(),
  requestId: z.string().trim().min(8).max(120).optional()
});

const TARGET_ROLES = ["student", "trader", "coach", "assistant", "leader", "super_admin"] as const;

function sanitizeIdPart(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "")
    .slice(0, 96);
}

function buildNotificationRowId(noticeId: string, toUserId: string) {
  return ["global", sanitizeIdPart(noticeId), sanitizeIdPart(toUserId)].join("_");
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user, db } = await requireAdmin();
    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const admin = dbAdmin();

    let targetIds: string[] | null = null;
    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      targetIds = treeIds;
      if (!targetIds.length) return json({ ok: true, sent: 0 });
    }

    let query = admin
      .from("profiles")
      .select("id,role")
      .in("role", TARGET_ROLES)
      .limit(5000);

    if (targetIds) {
      query = query.in("id", targetIds);
    }

    const { data: profiles, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const ids = (profiles || []).map((row: any) => String(row.id)).filter(Boolean);
    if (!ids.length) return json({ ok: true, sent: 0 });

    const noticeId = parsed.data.requestId || createD1TextId();
    const existing = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("from_user_id", user.id)
      .eq("global_notice_id", noticeId);
    if (!existing.error && Number(existing.count || 0) > 0) {
      return json({ ok: true, sent: Number(existing.count || 0), duplicated: true });
    }

    const pinnedAt = parsed.data.pinned ? new Date().toISOString() : null;
    const rows = ids.map((id) => ({
      id: buildNotificationRowId(noticeId, id),
      to_user_id: id,
      from_user_id: user.id,
      global_notice_id: noticeId,
      title: parsed.data.title,
      content: parsed.data.content,
      pinned_at: pinnedAt
    }));

    const ins = await db.from("notifications").insert(rows);
    if (ins.error) {
      const duplicated = await db
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("from_user_id", user.id)
        .eq("global_notice_id", noticeId);
      if (!duplicated.error && Number(duplicated.count || 0) > 0) {
        return json({ ok: true, sent: Number(duplicated.count || 0), duplicated: true });
      }
      return json({ ok: false, error: ins.error.message }, 500);
    }

    return json({ ok: true, sent: rows.length });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}

