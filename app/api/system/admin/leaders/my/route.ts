import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    const { user, db } = await requireAdmin();
    if (user.role !== "leader") return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);

    const treeIds = await fetchLeaderTreeIds(user.id);
    const scopedIds = treeIds.filter((id: string) => id !== user.id);
    if (!scopedIds.length) return noStoreJson({ ok: true, items: [] });

    const { data, error } = await db
      .from("profiles")
      .select("id,email,full_name,phone,role,status,created_at,last_login_at,leader_id")
      .eq("role", "leader")
      .in("id", scopedIds)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return noStoreJson({ ok: false, error: error.message }, 500);
    return noStoreJson({ ok: true, items: data || [] });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return noStoreJson({ ok: false, error: code }, status);
  }
}

