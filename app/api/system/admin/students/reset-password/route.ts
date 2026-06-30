import { NextResponse } from "next/server";
import { z } from "zod";

import { dbFirst } from "@/lib/d1";
import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { isStrongSystemPassword } from "@/lib/system/passwordPolicy";
import { updateLocalAuthPasswordByUserId } from "@/lib/system/localAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().trim().min(1).max(128),
  newPassword: z.string().min(8).max(64)
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => null));

    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);
    if (!isStrongSystemPassword(parsed.data.newPassword)) return json({ ok: false, error: "WEAK_PASSWORD" }, 400);

    const { userId, newPassword } = parsed.data;

    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      if (!treeIds.includes(userId)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const target = await dbFirst<{ id: string; role: string | null }>(
      "select id, role from profiles where id = ? limit 1",
      [userId]
    );
    if (!target?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
    const learnerRoles = ["student", "trader", "coach"];
    if (!learnerRoles.includes(String(target.role || ""))) return json({ ok: false, error: "FORBIDDEN" }, 403);

    await updateLocalAuthPasswordByUserId(userId, newPassword);

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}

