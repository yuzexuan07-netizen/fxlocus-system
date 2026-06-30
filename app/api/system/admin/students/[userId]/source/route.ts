import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { dbFirst, dbRun } from "@/lib/d1";
import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SourceParam = z.enum(["boss", "商业化", "其他渠道"]);
const Body = z.object({
  source: SourceParam.optional().nullable()
});

type TargetRow = {
  id: string;
  role: string | null;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: { params: { userId: string } }) {
  try {
    const { user } = await requireAdmin();
    const userId = String(ctx?.params?.userId || "").trim();
    if (!userId) return json({ ok: false, error: "INVALID_USER" }, 400);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      if (!treeIds.includes(userId)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const target = await dbFirst<TargetRow>("select id, role from profiles where id = ? limit 1", [userId]);
    if (!target?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);

    const source = parsed.data.source ?? null;
    await dbRun("update profiles set source = ?, updated_at = ? where id = ?", [
      source,
      new Date().toISOString(),
      userId
    ]);

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
