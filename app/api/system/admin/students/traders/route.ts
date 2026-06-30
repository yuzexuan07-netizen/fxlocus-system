import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { STUDENT_STATUS_PASSED_DONATION } from "@/lib/system/studentStatusValues";

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
    if (!treeIds.length) return noStoreJson({ ok: true, items: [] });

    const { data, error } = await db
      .from("profiles")
      .select("id,full_name,email,phone,status,student_status,created_at,last_login_at,leader_id")
      .or(`role.eq.trader,student_status.eq.${STUDENT_STATUS_PASSED_DONATION}`)
      .in("id", treeIds)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) return noStoreJson({ ok: false, error: error.message }, 500);
    return noStoreJson({ ok: true, items: data || [] });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return noStoreJson({ ok: false, error: code }, status);
  }
}

