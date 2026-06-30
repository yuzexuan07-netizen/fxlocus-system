import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { mapSystemApiError } from "@/lib/system/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function buildLadderNotification(status: "approved" | "rejected", reason: string) {
  const rejectionReason = reason || "Rejected";
  return {
    title:
      status === "approved"
        ? "天梯申请已通过 / Ladder approved"
        : "天梯申请已拒绝 / Ladder rejected",
    content:
      status === "approved"
        ? "你的天梯申请已通过，现在可以查看天梯。\n\nYour ladder request has been approved. You can view the ladder now."
        : `你的天梯申请已被拒绝，原因：${rejectionReason}\n\nYour ladder request was rejected. Reason: ${rejectionReason}`
  };
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAdmin();
    const admin = dbAdmin();
    const body = await req.json().catch(() => null);
    const userId = String(body?.userId || "");
    const action = String(body?.action || "");
    const reason = String(body?.reason || "");

    if (!userId) return json({ ok: false, error: "INVALID_BODY" }, 400);
    if (action !== "approve" && action !== "reject") {
      return json({ ok: false, error: "INVALID_ACTION" }, 400);
    }

    const status = action === "approve" ? "approved" : "rejected";
    const enabled = status === "approved";
    const now = new Date().toISOString();

    const existing = await admin
      .from("ladder_authorizations")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing.error) return json({ ok: false, error: existing.error.message }, 500);

    if (!existing.data) {
      const ins = await admin.from("ladder_authorizations").insert({
        user_id: userId,
        enabled,
        status,
        reviewed_at: now,
        reviewed_by: user.id,
        rejection_reason: status === "rejected" ? reason : null
      } as any);
      if (ins.error) return json({ ok: false, error: ins.error.message }, 500);

      const noteBody = buildLadderNotification(status, reason);
      const note = await admin.from("notifications").insert({
        to_user_id: userId,
        from_user_id: user.id,
        title: noteBody.title,
        content: noteBody.content
      } as any);
      if (note.error) return json({ ok: false, error: "NOTIFY_FAILED" }, 500);
      return json({ ok: true });
    }

    const up = await admin
      .from("ladder_authorizations")
      .update({
        enabled,
        status,
        reviewed_at: now,
        reviewed_by: user.id,
        rejection_reason: status === "rejected" ? reason : null
      } as any)
      .eq("user_id", userId);

    if (up.error) return json({ ok: false, error: up.error.message }, 500);

    const noteBody = buildLadderNotification(status, reason);
    const note = await admin.from("notifications").insert({
      to_user_id: userId,
      from_user_id: user.id,
      title: noteBody.title,
      content: noteBody.content
    } as any);
    if (note.error) return json({ ok: false, error: "NOTIFY_FAILED" }, 500);

    return json({ ok: true });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
