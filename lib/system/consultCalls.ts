import { randomUUID } from "crypto";

import { dbAll, dbFirst, dbRun } from "@/lib/d1";

let ensured = false;

export type ConsultCallSession = {
  id: string;
  caller_user_id: string;
  callee_user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  answered_at: string | null;
  ended_at: string | null;
};

export type ConsultCallSignal = {
  id: number;
  session_id: string;
  from_user_id: string;
  to_user_id: string;
  kind: string;
  payload: string | null;
  created_at: string;
};

const PENDING_CALL_REUSE_MAX_AGE_MS = 60_000;
const ACTIVE_CALL_STALE_MS = 90_000;

function formatCallDurationText(durationSec: number) {
  const safe = Math.max(1, Math.round(durationSec));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function insertCallSummaryMessage(session: ConsultCallSession, status: string, now: string) {
  if (!session?.id) return;
  let contentText = "";
  if (status === "ended" && session.answered_at) {
    const durationSec = Math.max(1, Math.round((toTimestamp(now) - toTimestamp(session.answered_at)) / 1000));
    contentText = `语音通话 ${formatCallDurationText(durationSec)} / Voice call ${formatCallDurationText(durationSec)}`;
  } else if (status === "rejected") {
    contentText = "语音通话已拒接 / Voice call declined";
  } else if (status === "missed") {
    contentText = "语音通话未接通 / Missed voice call";
  } else {
    return;
  }

  try {
    await dbRun(
      [
        "insert into consult_messages (",
        "id, from_user_id, to_user_id, content_type, content_text, created_at",
        ") values (?, ?, ?, 'text', ?, ?)"
      ].join(" "),
      [`call_summary_${session.id}_${status}`, session.caller_user_id, session.callee_user_id, contentText, now]
    );
  } catch (error: any) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("unique") || message.includes("constraint")) return;
    if (message.includes("no such table") || message.includes("no such column")) return;
    throw error;
  }
}

function toTimestamp(value: string | null | undefined) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function isFreshPendingCall(session: ConsultCallSession | null | undefined, now = Date.now()) {
  if (!session || session.status !== "pending") return false;
  const updatedAt = toTimestamp(session.updated_at || session.created_at);
  return updatedAt > 0 && now - updatedAt <= PENDING_CALL_REUSE_MAX_AGE_MS;
}

function isFreshActiveCall(session: ConsultCallSession | null | undefined, now = Date.now()) {
  if (!session || session.status !== "active") return false;
  const updatedAt = toTimestamp(session.updated_at || session.answered_at || session.created_at);
  return updatedAt > 0 && now - updatedAt <= ACTIVE_CALL_STALE_MS;
}

export async function ensureConsultCallTables() {
  if (ensured) return;
  await dbRun(
    [
      "create table if not exists consult_call_sessions (",
      "id text primary key,",
      "caller_user_id text not null,",
      "callee_user_id text not null,",
      "status text not null default 'pending',",
      "created_at text not null,",
      "updated_at text not null,",
      "answered_at text,",
      "ended_at text",
      ")"
    ].join(" ")
  );
  await dbRun(
    [
      "create table if not exists consult_call_signals (",
      "id integer primary key autoincrement,",
      "session_id text not null,",
      "from_user_id text not null,",
      "to_user_id text not null,",
      "kind text not null,",
      "payload text,",
      "created_at text not null",
      ")"
    ].join(" ")
  );
  await dbRun(
    "create index if not exists consult_call_sessions_status_idx on consult_call_sessions (status, updated_at desc)"
  );
  await dbRun(
    "create index if not exists consult_call_sessions_caller_idx on consult_call_sessions (caller_user_id, updated_at desc)"
  );
  await dbRun(
    "create index if not exists consult_call_sessions_callee_idx on consult_call_sessions (callee_user_id, updated_at desc)"
  );
  await dbRun(
    "create index if not exists consult_call_signals_session_idx on consult_call_signals (session_id, id asc)"
  );
  ensured = true;
}

export async function createConsultCallSession(callerUserId: string, calleeUserId: string) {
  await ensureConsultCallTables();
  const now = new Date().toISOString();
  const id = `call_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await dbRun(
    [
      "insert into consult_call_sessions (",
      "id, caller_user_id, callee_user_id, status, created_at, updated_at, answered_at, ended_at",
      ") values (?, ?, ?, 'pending', ?, ?, null, null)"
    ].join(" "),
    [id, callerUserId, calleeUserId, now, now]
  );
  return getConsultCallSession(id);
}

export async function getConsultCallSession(sessionId: string) {
  await ensureConsultCallTables();
  return dbFirst<ConsultCallSession>(
    [
      "select id, caller_user_id, callee_user_id, status, created_at, updated_at, answered_at, ended_at",
      "from consult_call_sessions where id = ? limit 1"
    ].join(" "),
    [sessionId]
  );
}

export async function getLatestVisibleConsultCallSession(userId: string, peerId?: string | null) {
  await ensureConsultCallTables();
  const filters = [
    "(caller_user_id = ? or callee_user_id = ?)",
    "status in ('pending','active')"
  ];
  const params: unknown[] = [userId, userId];
  if (peerId) {
    filters.push("(caller_user_id = ? or callee_user_id = ?)");
    params.push(peerId, peerId);
  }
  const session = await dbFirst<ConsultCallSession>(
    [
      "select id, caller_user_id, callee_user_id, status, created_at, updated_at, answered_at, ended_at",
      "from consult_call_sessions",
      `where ${filters.join(" and ")}`,
      "order by updated_at desc limit 1"
    ].join(" "),
    params
  );
  if (session?.status === "pending" && !isFreshPendingCall(session)) {
    return await updateConsultCallSessionStatus(session.id, "missed");
  }
  if (session?.status === "active" && !isFreshActiveCall(session)) {
    return await updateConsultCallSessionStatus(session.id, "ended");
  }
  return session;
}

export { isFreshActiveCall, isFreshPendingCall };

export async function updateConsultCallSessionStatus(
  sessionId: string,
  status: "pending" | "active" | "rejected" | "ended" | "missed"
) {
  await ensureConsultCallTables();
  const current = await getConsultCallSession(sessionId);
  if (!current) return null;
  const now = new Date().toISOString();
  const answeredAt = status === "active" ? now : null;
  const endedAt = status === "ended" || status === "rejected" || status === "missed" ? now : null;
  await dbRun(
    [
      "update consult_call_sessions",
      "set status = ?, updated_at = ?,",
      "answered_at = coalesce(?, answered_at),",
      "ended_at = coalesce(?, ended_at)",
      "where id = ?"
    ].join(" "),
    [status, now, answeredAt, endedAt, sessionId]
  );
  const next = await getConsultCallSession(sessionId);
  const statusChanged = current.status !== status;
  if (statusChanged && next && (status === "ended" || status === "rejected" || status === "missed")) {
    await insertCallSummaryMessage(
      {
        ...current,
        answered_at: next.answered_at || current.answered_at,
        ended_at: next.ended_at || endedAt,
        updated_at: next.updated_at || now
      },
      status,
      next.ended_at || now
    );
  }
  return next;
}

export async function touchConsultCallSession(sessionId: string) {
  await ensureConsultCallTables();
  const now = new Date().toISOString();
  await dbRun("update consult_call_sessions set updated_at = ? where id = ? and status in ('pending','active')", [
    now,
    sessionId
  ]);
  return getConsultCallSession(sessionId);
}

export async function insertConsultCallSignal(
  sessionId: string,
  fromUserId: string,
  toUserId: string,
  kind: string,
  payload?: string | null
) {
  await ensureConsultCallTables();
  const now = new Date().toISOString();
  await dbRun(
    [
      "insert into consult_call_signals (session_id, from_user_id, to_user_id, kind, payload, created_at)",
      "values (?, ?, ?, ?, ?, ?)"
    ].join(" "),
    [sessionId, fromUserId, toUserId, kind, payload || null, now]
  );
  await dbRun("update consult_call_sessions set updated_at = ? where id = ?", [now, sessionId]);
}

export async function listConsultCallSignals(sessionId: string, toUserId: string, afterId = 0) {
  await ensureConsultCallTables();
  return dbAll<ConsultCallSignal>(
    [
      "select id, session_id, from_user_id, to_user_id, kind, payload, created_at",
      "from consult_call_signals",
      "where session_id = ? and to_user_id = ? and id > ?",
      "order by id asc"
    ].join(" "),
    [sessionId, toUserId, afterId]
  );
}
