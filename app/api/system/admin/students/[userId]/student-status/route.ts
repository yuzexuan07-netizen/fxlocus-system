import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { dbFirst, dbRun } from "@/lib/d1";
import { requireManager } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import {
  normalizeStudentStatus,
  STUDENT_STATUS_DONATION,
  STUDENT_STATUS_PASSED,
  STUDENT_STATUS_PASSED_DONATION
} from "@/lib/system/studentStatusValues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_OPTIONS = [STUDENT_STATUS_PASSED, STUDENT_STATUS_DONATION, STUDENT_STATUS_PASSED_DONATION] as const;
const PASS_STATUSES = new Set([STUDENT_STATUS_PASSED, STUDENT_STATUS_PASSED_DONATION]);
const LEARNER_ROLES = new Set(["student", "trader", "coach", "assistant"]);

const Body = z.object({
  student_status: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1)
  )
});

type TargetRow = {
  id: string;
  role: string | null;
  student_status: string | null;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: { params: { userId: string } }) {
  try {
    const { user } = await requireManager();
    if (user.role === "coach" || user.role === "assistant") {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const userId = String(ctx?.params?.userId || "").trim();
    if (!userId) return json({ ok: false, error: "INVALID_USER" }, 400);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      if (!treeIds.includes(userId)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const target = await dbFirst<TargetRow>(
      "select id, role, student_status from profiles where id = ? limit 1",
      [userId]
    );
    if (!target?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);

    const fromRole = String(target.role || "");
    if (!LEARNER_ROLES.has(fromRole)) return json({ ok: false, error: "INVALID_TARGET" }, 400);

    const normalizedNextStatus = normalizeStudentStatus(parsed.data.student_status);
    if (!STATUS_OPTIONS.includes(normalizedNextStatus as any)) {
      return json({ ok: false, error: "INVALID_STATUS" }, 400);
    }

    let nextRole = fromRole;
    if (fromRole === "student" && PASS_STATUSES.has(normalizedNextStatus as any)) {
      nextRole = "trader";
    } else if (fromRole === "trader" && !PASS_STATUSES.has(normalizedNextStatus as any)) {
      nextRole = "student";
    }

    const now = new Date().toISOString();
    if (nextRole !== fromRole) {
      await dbRun("update profiles set student_status = ?, role = ?, updated_at = ? where id = ?", [
        normalizedNextStatus,
        nextRole,
        now,
        userId
      ]);
    } else {
      await dbRun("update profiles set student_status = ?, updated_at = ? where id = ?", [
        normalizedNextStatus,
        now,
        userId
      ]);
    }

    return json({ ok: true, role: nextRole });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
