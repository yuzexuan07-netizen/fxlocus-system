import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().trim().min(1).max(128),
  status: z.enum(["active", "frozen"])
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const admin = dbAdmin();
    const { data: target, error: targetErr } = await admin
      .from("profiles")
      .select("id,role,leader_id")
      .eq("id", parsed.data.userId)
      .maybeSingle();
    if (targetErr) return json({ ok: false, error: targetErr.message }, 500);
    if (!target?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
    if (target.role !== "assistant") return json({ ok: false, error: "INVALID_TARGET" }, 400);
    if (user.role === "leader" && target.leader_id !== user.id) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const now = new Date().toISOString();
    const up = await admin
      .from("profiles")
      .update({ status: parsed.data.status, updated_at: now } as any)
      .eq("id", target.id)
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
