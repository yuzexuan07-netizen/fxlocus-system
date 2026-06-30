import { NextResponse } from "next/server";

import { canConsultWith } from "@/lib/system/consult";
import { requireSystemUser } from "@/lib/system/guard";
import { dbRun } from "@/lib/d1";
import { invalidateConsultCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const ctx = await requireSystemUser();
    const body = await req.json().catch(() => ({}));
    const peerId = String(body?.peerId || "").trim();
    if (!peerId || peerId.length > 128) return json({ ok: false, error: "INVALID_PEER" }, 400);

    const allowed = await canConsultWith(ctx, peerId);
    if (!allowed) return json({ ok: false, error: "FORBIDDEN" }, 403);

    await dbRun("update consult_messages set read_at = null where to_user_id = ? and from_user_id = ?", [
      ctx.user.id,
      peerId
    ]);
    invalidateConsultCache();
    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
