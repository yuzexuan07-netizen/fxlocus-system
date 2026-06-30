import { NextResponse } from "next/server";

import { requireLearner } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { buildStudentSubmitContent, notifyLeadersAndAdmins } from "@/lib/system/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  try {
    const { user } = await requireLearner();
    const admin = dbAdmin();
    const now = new Date().toISOString();

    const existing = await admin
      .from("ladder_authorizations")
      .select("user_id,status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing.error) return json({ ok: false, error: existing.error.message }, 500);

    if (!existing.data) {
      const ins = await admin.from("ladder_authorizations").insert({
        user_id: user.id,
        enabled: false,
        status: "requested",
        requested_at: now
      } as any);
      if (ins.error) return json({ ok: false, error: ins.error.message }, 500);
      await notifyLeadersAndAdmins(user, {
        title: "天梯申请 / Ladder request",
        content: buildStudentSubmitContent(user, "提交了天梯申请。", "requested ladder access.")
      });
      return json({ ok: true });
    }

    const up = await admin
      .from("ladder_authorizations")
      .update({
        enabled: false,
        status: "requested",
        requested_at: now,
        reviewed_at: null,
        reviewed_by: null,
        rejection_reason: null
      } as any)
      .eq("user_id", user.id);

    if (up.error) return json({ ok: false, error: up.error.message }, 500);
    await notifyLeadersAndAdmins(user, {
      title: "天梯申请 / Ladder request",
      content: buildStudentSubmitContent(user, "重新提交了天梯申请。", "re-requested ladder access.")
    });
    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
