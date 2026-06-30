import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { mapSystemApiError } from "@/lib/system/apiError";
import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Params = z.object({
  coachId: z.string().trim().min(1).max(128)
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    const { user, db } = await requireAdmin();
    const raw = { coachId: req.nextUrl.searchParams.get("coachId") || "" };
    const parsed = Params.safeParse(raw);
    if (!parsed.success) return json({ ok: false, error: "INVALID_COACH" }, 400);

    const coachId = parsed.data.coachId;
    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      if (!treeIds.includes(coachId)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const { data: assignments, error: assignErr } = await db
      .from("coach_assignments")
      .select("assigned_user_id")
      .eq("coach_id", coachId);
    if (assignErr) return json({ ok: false, error: assignErr.message }, 500);

    const assignedIds = (assignments || []).map((row) => row.assigned_user_id).filter(Boolean) as string[];
    if (!assignedIds.length) return json({ ok: true, items: [] });

    let query = db
      .from("profiles")
      .select("id,full_name,email,phone,role,student_status,status,leader_id")
      .in("id", assignedIds)
      .order("created_at", { ascending: false })
      .limit(500);

    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      if (!treeIds.length) return json({ ok: true, items: [] });
      query = query.in("id", treeIds);
    }

    const { data: users, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, items: users || [] });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}

