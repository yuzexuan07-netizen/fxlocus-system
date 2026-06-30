export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { requireSystemUser } from "@/lib/system/guard";
import { isSuperAdmin } from "@/lib/system/roles";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { LADDER_IMAGE_URL, LADDER_REFRESH_MS } from "@/lib/system/ladderConfig";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    const { user } = await requireSystemUser();
    const admin = dbAdmin();
    const { data: cfg } = await admin.from("ladder_config").select("image_url,refresh_ms").eq("id", 1).maybeSingle();
    const imageUrl = cfg?.image_url || LADDER_IMAGE_URL;
    const refreshMs = Number(cfg?.refresh_ms || LADDER_REFRESH_MS);

    if (isSuperAdmin(user.role)) {
      return json({
        ok: true,
        authorized: true,
        status: "approved",
        imageUrl,
        refreshMs
      });
    }

    const { data: row, error } = await admin
      .from("ladder_authorizations")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);

    const status = String(row?.status || "none");
    const authorized = status === "approved";

    return json({
      ok: true,
      authorized,
      status,
      imageUrl: authorized ? imageUrl : null,
      refreshMs
    });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
