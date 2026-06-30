import "server-only";

import { dbAll, dbBatch } from "@/lib/d1";

type PinnedNoticeSource = {
  global_notice_id: string | null;
  from_user_id: string | null;
  title: string | null;
  content: string | null;
  pinned_at: string | null;
  created_at: string | null;
};

const SYNC_CACHE_TTL_MS = 60_000;
const MAX_MISSING_PINNED_NOTICES = 100;

const g = globalThis as {
  __fx_pinned_notifications_sync_cache?: Map<string, number>;
};

if (!g.__fx_pinned_notifications_sync_cache) {
  g.__fx_pinned_notifications_sync_cache = new Map();
}

const syncCache = g.__fx_pinned_notifications_sync_cache;

function sanitizeIdPart(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "")
    .slice(0, 96);
}

function materializedNotificationId(toUserId: string, globalNoticeId: string, fromUserId: string) {
  return [
    "pinned",
    sanitizeIdPart(globalNoticeId),
    sanitizeIdPart(fromUserId || "system"),
    sanitizeIdPart(toUserId)
  ].join("_");
}

function sweepSyncCache(now: number) {
  if (!syncCache.size) return;
  for (const [key, exp] of syncCache.entries()) {
    if (exp <= now) syncCache.delete(key);
  }
}

export async function materializePinnedNotificationsForUser(userId: string) {
  const targetUserId = String(userId || "").trim();
  if (!targetUserId) return 0;

  const nowMs = Date.now();
  sweepSyncCache(nowMs);
  const cachedUntil = syncCache.get(targetUserId);
  if (cachedUntil && cachedUntil > nowMs) return 0;

  const sources = await dbAll<PinnedNoticeSource>(
    [
      "with recursive ancestors(id, role, leader_id) as (",
      "  select id, role, leader_id from profiles where id = ?",
      "  union all",
      "  select p.id, p.role, p.leader_id",
      "  from profiles p join ancestors a on p.id = a.leader_id",
      "  where a.leader_id is not null",
      "),",
      "eligible_senders as (",
      "  select id from profiles where role = 'super_admin'",
      "  union",
      "  select id from ancestors where role = 'leader'",
      "),",
      "ranked_notices as (",
      "  select",
      "    n.global_notice_id,",
      "    n.from_user_id,",
      "    n.title,",
      "    n.content,",
      "    n.pinned_at,",
      "    n.created_at,",
      "    row_number() over (",
      "      partition by n.global_notice_id, n.from_user_id",
      "      order by n.pinned_at desc, n.created_at desc",
      "    ) as rn",
      "  from notifications n",
      "  join eligible_senders s on s.id = n.from_user_id",
      "  where n.global_notice_id is not null",
      "    and n.pinned_at is not null",
      ")",
      "select global_notice_id, from_user_id, title, content, pinned_at, created_at",
      "from ranked_notices n",
      "where n.rn = 1",
      "  and not exists (",
      "    select 1 from notifications existing",
      "    where existing.to_user_id = ?",
      "      and existing.global_notice_id = n.global_notice_id",
      "      and existing.from_user_id = n.from_user_id",
      "  )",
      "order by n.pinned_at desc, n.created_at desc",
      `limit ${MAX_MISSING_PINNED_NOTICES}`
    ].join(" "),
    [targetUserId, targetUserId]
  );

  const nowIso = new Date().toISOString();
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  for (const source of sources || []) {
    const globalNoticeId = String(source.global_notice_id || "").trim();
    const fromUserId = String(source.from_user_id || "").trim();
    const title = String(source.title || "").trim();
    if (!globalNoticeId || !fromUserId || !title) continue;
    statements.push({
      sql: [
        "insert or ignore into notifications",
        "(id, to_user_id, from_user_id, global_notice_id, title, content, pinned_at, created_at)",
        "values (?, ?, ?, ?, ?, ?, ?, ?)"
      ].join(" "),
      params: [
        materializedNotificationId(targetUserId, globalNoticeId, fromUserId),
        targetUserId,
        fromUserId,
        globalNoticeId,
        title,
        source.content ?? null,
        source.pinned_at || nowIso,
        source.created_at || source.pinned_at || nowIso
      ]
    });
  }

  if (statements.length) {
    await dbBatch(statements);
  }

  syncCache.set(targetUserId, Date.now() + SYNC_CACHE_TTL_MS);
  return statements.length;
}
