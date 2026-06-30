import { NextResponse } from "next/server";

import { requireSystemUser } from "@/lib/system/guard";
import { dbFirst, dbRun } from "@/lib/d1";
import { invalidateConsultCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_CONSULT_MESSAGE_ID_LENGTH = 256;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const ctx = await requireSystemUser();
    const body = await req.json().catch(() => ({}));
    const messageId = String(body?.messageId || "").trim();
    if (!messageId || messageId.length > MAX_CONSULT_MESSAGE_ID_LENGTH) {
      return json({ ok: false, error: "INVALID_MESSAGE" }, 400);
    }

    const data = await dbFirst<{ id: string; from_user_id: string | null; created_at: string | null }>(
      "select id, from_user_id, created_at from consult_messages where id = ? limit 1",
      [messageId]
    );
    if (!data?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
    if (data.from_user_id !== ctx.user.id) return json({ ok: false, error: "FORBIDDEN" }, 403);

    await dbRun("delete from consult_messages where id = ?", [messageId]);
    invalidateConsultCache();
    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
