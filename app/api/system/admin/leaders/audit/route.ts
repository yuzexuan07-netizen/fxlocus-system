import { NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/system/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    const { db } = await requireSuperAdmin();

    const { data, error } = await db
      .from("role_audit_logs")
      .select("id,created_at,from_role,to_role,reason,target_id,actor_id")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return json({ ok: false, error: error.message }, 500);

    const rows = (data || []) as Array<{
      id: string;
      created_at: string | null;
      from_role: string | null;
      to_role: string | null;
      reason: string | null;
      target_id: string | null;
      actor_id: string | null;
    }>;

    const profileIds = Array.from(
      new Set(
        rows
          .flatMap((row) => [row.target_id, row.actor_id])
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      )
    );

    const { data: profiles, error: profileErr } = profileIds.length
      ? await db.from("profiles").select("id,full_name,email").in("id", profileIds)
      : ({ data: [], error: null } as any);

    if (profileErr) return json({ ok: false, error: profileErr.message }, 500);

    const profileById = new Map((profiles || []).map((row: any) => [String(row.id), row]));

    const items = rows.map((row) => ({
      ...row,
      target: row.target_id ? profileById.get(String(row.target_id)) || null : null,
      actor: row.actor_id ? profileById.get(String(row.actor_id)) || null : null
    }));

    return json({ ok: true, items });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}

