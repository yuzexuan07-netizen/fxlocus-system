import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/system/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().trim().min(1).max(128),
  freeze: z.boolean()
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { db, user } = await requireAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => null));

    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const { userId, freeze } = parsed.data;
    if (userId === user.id) return json({ ok: false, error: "SELF_OPERATION_NOT_ALLOWED" }, 400);

    const now = new Date().toISOString();
    const up = await db
      .from("profiles")
      .update({ status: freeze ? "frozen" : "active", updated_at: now } as any)
      .eq("id", userId)
      .select("id")
      .maybeSingle();

    if (up.error) return json({ ok: false, error: up.error.message }, 500);
    if (!up.data?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
