import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { dbFirst, dbRun } from "@/lib/d1";
import { requireManager } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  status: z.enum(["active", "frozen"])
});

type TargetRow = {
  id: string;
  role: string | null;
  created_by: string | null;
};

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

async function fetchTarget(userId: string) {
  try {
    return await dbFirst<TargetRow>(
      "select id, role, created_by from profiles where id = ? limit 1",
      [userId]
    );
  } catch {
    return dbFirst<TargetRow>(
      "select id, role, null as created_by from profiles where id = ? limit 1",
      [userId]
    );
  }
}

export async function POST(req: NextRequest, ctx: { params: { userId: string } }) {
  try {
    const { user } = await requireManager();
    if (user.role === "coach") return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);

    const userId = String(ctx?.params?.userId || "").trim();
    if (!userId) return noStoreJson({ ok: false, error: "INVALID_USER" }, 400);
    if (userId === user.id) return noStoreJson({ ok: false, error: "SELF_OPERATION_NOT_ALLOWED" }, 400);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return noStoreJson({ ok: false, error: "INVALID_BODY" }, 400);

    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      if (!treeIds.includes(userId)) return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const target = await fetchTarget(userId);
    if (!target?.id) return noStoreJson({ ok: false, error: "NOT_FOUND" }, 404);
    if (String(target.role || "") === "super_admin" && user.role !== "super_admin") {
      return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);
    }
    if (user.role === "assistant") {
      if (target.id !== user.id && String(target.created_by || "") !== user.id) {
        return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);
      }
    }

    await dbRun("update profiles set status = ?, updated_at = ? where id = ?", [
      parsed.data.status,
      new Date().toISOString(),
      userId
    ]);

    return noStoreJson({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return noStoreJson({ ok: false, error: code }, status);
  }
}
