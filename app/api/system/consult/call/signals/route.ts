import { NextResponse } from "next/server";

import {
  getConsultCallSession,
  insertConsultCallSignal,
  listConsultCallSignals
} from "@/lib/system/consultCalls";
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
    const afterId = Math.max(0, Number(url.searchParams.get("afterId") || 0));
    if (!sessionId) return json({ ok: false, error: "INVALID_SESSION" }, 400);
    const session = await getConsultCallSession(sessionId);
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);
    if (session.caller_user_id !== ctx.user.id && session.callee_user_id !== ctx.user.id) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }
    const signals = await listConsultCallSignals(sessionId, ctx.user.id, afterId);
    return json({ ok: true, signals });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "CALL_SIGNALS_FAILED" }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireSystemUser();
    const body = await req.json().catch(() => null);
    const sessionId = String(body?.sessionId || "").trim();
    const kind = String(body?.kind || "").trim();
    const payload = body?.payload == null ? null : JSON.stringify(body.payload);
    if (!sessionId || !kind) return json({ ok: false, error: "INVALID_SIGNAL" }, 400);
    const session = await getConsultCallSession(sessionId);
    if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404);
    if (session.caller_user_id !== ctx.user.id && session.callee_user_id !== ctx.user.id) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }
    const peerId = session.caller_user_id === ctx.user.id ? session.callee_user_id : session.caller_user_id;
    await insertConsultCallSignal(sessionId, ctx.user.id, peerId, kind, payload);
    return json({ ok: true });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "SEND_CALL_SIGNAL_FAILED" }, 500);
  }
}
