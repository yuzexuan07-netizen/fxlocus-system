import { NextResponse } from "next/server";

import {
  createConsultCallSession,
  getConsultCallSession,
  getLatestVisibleConsultCallSession,
  isFreshPendingCall,
  insertConsultCallSignal,
  touchConsultCallSession,
  updateConsultCallSessionStatus
} from "@/lib/system/consultCalls";
import { canConsultWith } from "@/lib/system/consult";
import { requireSystemUser } from "@/lib/system/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  try {
    const ctx = await requireSystemUser();
    const url = new URL(req.url);
    const sessionId = String(url.searchParams.get("sessionId") || "").trim();
    const peerId = String(url.searchParams.get("peerId") || "").trim();
    const session = sessionId
      ? await getConsultCallSession(sessionId)
      : await getLatestVisibleConsultCallSession(ctx.user.id, peerId || null);
    if (!session) return json({ ok: true, session: null });
    if (session.caller_user_id !== ctx.user.id && session.callee_user_id !== ctx.user.id) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }
    return json({ ok: true, session });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "CALL_SESSION_FAILED" }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireSystemUser();
    const body = await req.json().catch(() => null);
    const action = String(body?.action || "").trim();

    if (action === "start") {
      const peerId = String(body?.peerId || "").trim();
      if (!peerId) return json({ ok: false, error: "INVALID_PEER" }, 400);
      const allowed = await canConsultWith(ctx, peerId);
      if (!allowed) return json({ ok: false, error: "FORBIDDEN" }, 403);
      const existing = await getLatestVisibleConsultCallSession(ctx.user.id, peerId);
      if (existing?.status === "active") return json({ ok: true, session: existing, reused: true });
      if (existing?.status === "pending" && isFreshPendingCall(existing)) {
        return json({ ok: true, session: existing, reused: true });
      }
      const session = await createConsultCallSession(ctx.user.id, peerId);
      return json({ ok: true, session });
    }

    const sessionId = String(body?.sessionId || "").trim();
    if (!sessionId) return json({ ok: false, error: "INVALID_SESSION" }, 400);
    const session = await getConsultCallSession(sessionId);
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);
    if (session.caller_user_id !== ctx.user.id && session.callee_user_id !== ctx.user.id) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }
    const peerId = session.caller_user_id === ctx.user.id ? session.callee_user_id : session.caller_user_id;

    if (action === "heartbeat") {
      const next = await touchConsultCallSession(sessionId);
      return json({ ok: true, session: next });
    }

    if (action === "accept") {
      if (session.callee_user_id !== ctx.user.id) return json({ ok: false, error: "FORBIDDEN" }, 403);
      const next = await updateConsultCallSessionStatus(sessionId, "active");
      await insertConsultCallSignal(sessionId, ctx.user.id, peerId, "accept");
      return json({ ok: true, session: next });
    }

    if (action === "reject") {
      const next = await updateConsultCallSessionStatus(sessionId, "rejected");
      await insertConsultCallSignal(sessionId, ctx.user.id, peerId, "reject");
      return json({ ok: true, session: next });
    }

    if (action === "end") {
      const next = await updateConsultCallSessionStatus(sessionId, "ended");
      await insertConsultCallSignal(sessionId, ctx.user.id, peerId, "end");
      return json({ ok: true, session: next });
    }

    return json({ ok: false, error: "INVALID_ACTION" }, 400);
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "CALL_ACTION_FAILED" }, 500);
  }
}
