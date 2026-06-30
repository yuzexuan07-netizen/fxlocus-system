import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { dbAdmin } from "@/lib/system/dbAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userIds: z.array(z.string().trim().min(1).max(128)).min(1),
  title: z.string().min(1).max(80),
  content: z.string().max(2000).optional()
});

const ALLOWED_ROLES = new Set(["student", "trader", "coach", "assistant", "leader"]);

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user, db } = await requireAdmin();
    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const uniqueIds = Array.from(new Set(parsed.data.userIds));
    const admin = dbAdmin();
    const { data: profiles, error: profileErr } = await admin
      .from("profiles")
      .select("id,role")
      .in("id", uniqueIds);
    if (profileErr) return json({ ok: false, error: profileErr.message }, 500);
    const profileById = new Map((profiles || []).map((p: any) => [String(p.id), p]));
    if (profileById.size !== uniqueIds.length) {
      return json({ ok: false, error: "NOT_FOUND" }, 404);
    }
    const invalidRole = uniqueIds.find((id) => !ALLOWED_ROLES.has(String(profileById.get(id)?.role || "")));
    if (invalidRole) return json({ ok: false, error: "FORBIDDEN" }, 403);

    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      const denied = uniqueIds.find((id) => !treeIds.includes(id));
      if (denied) return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const rows = uniqueIds.map((id) => ({
      to_user_id: id,
      from_user_id: user.id,
      title: parsed.data.title,
      content: parsed.data.content ?? null
    }));

    const ins = await db.from("notifications").insert(rows);
    if (ins.error) return json({ ok: false, error: ins.error.message }, 500);
    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}


