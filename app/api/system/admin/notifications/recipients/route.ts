import { NextResponse } from "next/server";

import { mapSystemApiError } from "@/lib/system/apiError";
import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { dbAdmin } from "@/lib/system/dbAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["student", "trader", "coach", "assistant", "leader"] as const;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    const { user, db } = await requireAdmin();
    const admin = dbAdmin();

    let targetIds: string[] | null = null;
    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      targetIds = treeIds.filter((id) => id !== user.id);
      if (!targetIds.length) return json({ ok: true, items: [] });
    }

    let query = admin
      .from("profiles")
      .select("id,full_name,email,role")
      .in("role", ALLOWED_ROLES)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (targetIds) {
      query = query.in("id", targetIds);
    }

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const items = (data || []).map((row: any) => ({
      id: String(row.id),
      full_name: row.full_name ?? null,
      email: row.email ?? null,
      role: row.role ?? null
    }));

    return json({ ok: true, items });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}

