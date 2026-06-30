import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdmin } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Email = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z
    .string()
    .min(3)
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address")
);

const Body = z
  .object({
    targetId: z.string().trim().min(1).max(128).optional(),
    email: Email.optional(),
    toRole: z.enum(["student", "leader", "super_admin"]),
    leaderId: z.string().trim().min(1).max(128).optional(),
    reason: z.string().max(500).optional()
  })
  .refine((v) => Boolean(v.targetId) !== Boolean(v.email), { message: "Provide targetId or email" });

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user: actor } = await requireSuperAdmin();
    const admin = dbAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const now = new Date().toISOString();
    const email = parsed.data.email?.trim().toLowerCase();

    const { data: target, error: targetErr } = parsed.data.targetId
      ? await admin.from("profiles").select("id,email,role,leader_id").eq("id", parsed.data.targetId).maybeSingle()
      : await admin.from("profiles").select("id,email,role,leader_id").eq("email", email!).maybeSingle();

    if (targetErr) return json({ ok: false, error: targetErr.message }, 500);
    if (!target?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
    if (target.id === actor.id) return json({ ok: false, error: "CANNOT_EDIT_SELF" }, 400);

    const fromRole = target.role;
    const toRole = parsed.data.toRole;
    if (fromRole === toRole) return json({ ok: true, id: target.id, role: toRole });

    let leaderId: string | null = null;
    const demoteLeaderToStudent = fromRole === "leader" && toRole === "student";
    if (toRole === "student") {
      leaderId = demoteLeaderToStudent ? actor.id : parsed.data.leaderId || null;
      if (leaderId && !demoteLeaderToStudent) {
        const { data: leader, error: leaderErr } = await admin
          .from("profiles")
          .select("id,role")
          .eq("id", leaderId)
          .maybeSingle();
        if (leaderErr) return json({ ok: false, error: leaderErr.message }, 500);
        if (!leader?.id || leader.role !== "leader") return json({ ok: false, error: "INVALID_LEADER" }, 400);
      }
    }

    const patch: Record<string, unknown> = {
      role: toRole,
      updated_at: now
    };

    if (toRole === "student") {
      patch.leader_id = leaderId;
    } else if (toRole === "super_admin") {
      patch.leader_id = null;
    }

    const up = await admin
      .from("profiles")
      .update(patch as any)
      .eq("id", target.id)
      .select("id,role")
      .maybeSingle();

    if (up.error) return json({ ok: false, error: up.error.message }, 500);
    if (!up.data?.id) return json({ ok: false, error: "UPDATE_FAILED" }, 500);

    const audit = await admin.from("role_audit_logs").insert({
      target_id: target.id,
      actor_id: actor.id,
      from_role: fromRole,
      to_role: toRole,
      reason: parsed.data.reason || null,
      created_at: now
    } as any);

    if (demoteLeaderToStudent) {
      const transfer = await admin
        .from("profiles")
        .update({ leader_id: actor.id, updated_at: now } as any)
        .in("role", ["student", "trader", "coach", "leader"])
        .eq("leader_id", target.id);
      if (transfer.error) {
        return json({ ok: false, error: transfer.error.message }, 500);
      }
    }

    if (audit.error) return json({ ok: true, id: target.id, role: toRole, audit: "FAILED" });
    return json({ ok: true, id: target.id, role: toRole });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
