import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { dbAdmin } from "@/lib/system/dbAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    const { user: actor } = await requireAdmin();
    const admin = dbAdmin();

    const learnerRoles = ["student", "trader", "coach"];
    let allowedUserIds: string[] | null = null;
    if (actor.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(actor.id);
      if (!treeIds.length) return json({ ok: true, items: [] });
      const { data: team } = await admin
        .from("profiles")
        .select("id")
        .in("id", treeIds)
        .in("role", learnerRoles)
        .limit(5000);
      allowedUserIds = (team || []).map((t: any) => String(t.id)).filter(Boolean);
      if (!allowedUserIds.length) return json({ ok: true, items: [] });
    }

    const q = admin
      .from("ladder_authorizations")
      .select("user_id,status,requested_at")
      .eq("status", "requested")
      .order("requested_at", { ascending: false });

    const scoped = await (allowedUserIds ? q.in("user_id", allowedUserIds).limit(300) : q.limit(300));

    if (scoped.error) return json({ ok: false, error: scoped.error.message }, 500);

    const rows = scoped.data || [];
    const userIds = Array.from(new Set(rows.map((r: any) => String(r.user_id)).filter(Boolean)));

    const usersRes = userIds.length
      ? await admin.from("profiles").select("id,full_name,email,phone").in("id", userIds)
      : ({ data: [], error: null } as any);

    if (usersRes.error) return json({ ok: false, error: usersRes.error.message }, 500);

    const usersById = new Map((usersRes.data || []).map((u: any) => [u.id, u]));
    const items = rows.map((r: any) => ({
      user_id: r.user_id,
      status: r.status,
      requested_at: r.requested_at,
      user: usersById.get(r.user_id) || null
    }));

    return json({ ok: true, items });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}

