import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSystemUser } from "@/lib/system/guard";
import { isStrongSystemPassword } from "@/lib/system/passwordPolicy";
import {
  findLocalAuthByUserId,
  updateLocalAuthPasswordByUserId,
  verifyLocalPassword
} from "@/lib/system/localAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(64)
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const ctx = await requireSystemUser();

    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    if (!isStrongSystemPassword(parsed.data.newPassword)) {
      return json({ ok: false, error: "WEAK_PASSWORD" }, 400);
    }

    const authRow = await findLocalAuthByUserId(ctx.user.id);
    if (!authRow?.user_id) return json({ ok: false, error: "BAD_PASSWORD" }, 401);

    const passOk = await verifyLocalPassword(parsed.data.currentPassword, authRow.password_hash);
    if (!passOk) return json({ ok: false, error: "BAD_PASSWORD" }, 401);

    await updateLocalAuthPasswordByUserId(ctx.user.id, parsed.data.newPassword);

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
