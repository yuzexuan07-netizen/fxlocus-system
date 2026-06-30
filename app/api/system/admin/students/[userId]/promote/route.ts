import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { dbFirst, dbRun } from "@/lib/d1";
import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { resolveExistingProfileId } from "@/lib/system/profileRefs";
import {
  normalizeStudentStatus,
  STUDENT_STATUS_PASSED,
  STUDENT_STATUS_PASSED_DONATION
} from "@/lib/system/studentStatusValues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["leader", "coach"]),
  direct: z.boolean().optional()
});

const LEARNER_ROLES = new Set(["student", "trader", "coach"]);
const LEADER_PROMOTABLE_ROLES = new Set(["student", "trader", "coach", "assistant"]);

type TargetRow = {
  id: string;
  role: string | null;
  leader_id: string | null;
  student_status: string | null;
};

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function normalizeTargetLeaderId(
  actorRole: "leader" | "super_admin",
  actorId: string,
  currentLeaderId: string | null,
  direct: boolean
) {
  if (direct) return actorId;
  if (currentLeaderId && currentLeaderId.trim()) return currentLeaderId;
  if (actorRole === "leader") return actorId;
  return null;
}

async function writeRoleAudit(
  targetId: string,
  actorId: string,
  fromRole: string,
  toRole: "leader" | "coach"
) {
  try {
    await dbRun(
      [
        "insert into role_audit_logs (target_id, actor_id, from_role, to_role, reason, created_at)",
        "values (?, ?, ?, ?, ?, ?)"
      ].join(" "),
      [targetId, actorId, fromRole, toRole, null, new Date().toISOString()]
    );
  } catch {
    // keep promotion successful even if audit table is temporarily unavailable
  }
}

export async function POST(req: NextRequest, ctx: { params: { userId: string } }) {
  let actorId = "";
  let actorRole: "leader" | "super_admin" = "leader";
  try {
    const { user } = await requireAdmin();
    actorId = user.id;
    actorRole = user.role === "super_admin" ? "super_admin" : "leader";
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return noStoreJson({ ok: false, error: code }, status);
  }

  const userId = String(ctx?.params?.userId || "").trim();
  if (!userId) return noStoreJson({ ok: false, error: "INVALID_USER" }, 400);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ ok: false, error: "INVALID_BODY" }, 400);

  if (actorRole === "leader") {
    const treeIds = await fetchLeaderTreeIds(actorId);
    if (!treeIds.includes(userId)) return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);
  }

  const target = await dbFirst<TargetRow>(
    "select id, role, leader_id, student_status from profiles where id = ? limit 1",
    [userId]
  );
  if (!target?.id) return noStoreJson({ ok: false, error: "NOT_FOUND" }, 404);

  const action = parsed.data.action;
  const direct = actorRole === "super_admin" && parsed.data.direct === true;
  const fromRole = String(target.role || "");
  const now = new Date().toISOString();
  const safeCurrentLeaderId = await resolveExistingProfileId(target.leader_id);

  if (action === "leader") {
    if (fromRole === "leader") return noStoreJson({ ok: true, role: "leader" });
    if (!LEADER_PROMOTABLE_ROLES.has(fromRole)) {
      return noStoreJson({ ok: false, error: "INVALID_TARGET" }, 400);
    }

    const nextLeaderId = normalizeTargetLeaderId(actorRole, actorId, safeCurrentLeaderId, direct);
    await dbRun(
      "update profiles set role = ?, leader_id = ?, updated_at = ? where id = ?",
      ["leader", nextLeaderId, now, userId]
    );
    await writeRoleAudit(userId, actorId, fromRole, "leader");
    return noStoreJson({ ok: true, role: "leader" });
  }

  if (fromRole === "coach") return noStoreJson({ ok: true, role: "coach" });
  if (!LEARNER_ROLES.has(fromRole)) return noStoreJson({ ok: false, error: "INVALID_TARGET" }, 400);

  const normalizedStatus = normalizeStudentStatus(target.student_status);
  const eligibleForCoach =
    normalizedStatus === STUDENT_STATUS_PASSED || normalizedStatus === STUDENT_STATUS_PASSED_DONATION;
  if (!direct && !eligibleForCoach) {
    return noStoreJson({ ok: false, error: "NOT_ELIGIBLE" }, 400);
  }

  const nextLeaderId = normalizeTargetLeaderId(actorRole, actorId, safeCurrentLeaderId, direct);
  await dbRun(
    "update profiles set role = ?, leader_id = ?, updated_at = ? where id = ?",
    ["coach", nextLeaderId, now, userId]
  );
  await writeRoleAudit(userId, actorId, fromRole, "coach");
  return noStoreJson({ ok: true, role: "coach" });
}
