import { dbAll, dbFirst, sqlPlaceholders, type D1Row } from "@/lib/d1";
import type { SystemUserSafe } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchStudentSupportNames } from "@/lib/system/studentSupport";
import { isMissingSchemaError } from "@/lib/system/schema";

const CONTACTABLE_ROLES = ["student", "trader", "coach", "assistant", "leader"] as const;
const LEARNER_ROLES = ["student", "trader", "coach"] as const;
const PROFILE_FIELD_SETS = [
  "id, full_name, email, phone, role, avatar_url, status, created_at",
  "id, full_name, email, phone, role, avatar_url, status",
  "id, full_name, email, phone, role, status",
  "id, email, phone, role, status",
  "id, full_name, email, phone, role, avatar_url, created_at",
  "id, full_name, email, phone, role, avatar_url",
  "id, full_name, email, phone, role",
  "id, email, phone, role"
];

export type ConsultRecipient = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone?: string | null;
  role: string | null;
  avatar_url: string | null;
  last_message_at?: string | null;
  support_name?: string | null;
  assistant_name?: string | null;
  coach_name?: string | null;
};

type SystemContext = {
  user: SystemUserSafe;
  db: unknown;
};

const RECIPIENT_CACHE_TTL_MS = 30_000;
const RECIPIENT_CACHE_MAX_KEYS = 320;
const CAN_CONSULT_CACHE_TTL_MS = 30_000;
const CAN_CONSULT_CACHE_MAX_KEYS = 2_000;
const CONSULT_RETENTION_DAYS = 30;
const MAX_IN_CLAUSE_SIZE = 80;
const g = globalThis as {
  __fx_consult_recipients_cache?: Map<string, { exp: number; items: ConsultRecipient[] }>;
  __fx_consult_recipients_inflight?: Map<string, Promise<ConsultRecipient[]>>;
  __fx_consult_allowed_cache?: Map<string, { exp: number; value: boolean }>;
  __fx_consult_allowed_inflight?: Map<string, Promise<boolean>>;
};
if (!g.__fx_consult_recipients_cache) g.__fx_consult_recipients_cache = new Map();
if (!g.__fx_consult_recipients_inflight) g.__fx_consult_recipients_inflight = new Map();
if (!g.__fx_consult_allowed_cache) g.__fx_consult_allowed_cache = new Map();
if (!g.__fx_consult_allowed_inflight) g.__fx_consult_allowed_inflight = new Map();
const recipientCache = g.__fx_consult_recipients_cache;
const recipientInflight = g.__fx_consult_recipients_inflight;
const canConsultCache = g.__fx_consult_allowed_cache;
const canConsultInflight = g.__fx_consult_allowed_inflight;

type ProfileRoleRow = {
  id: string;
  role: string | null;
  status?: string | null;
};

async function safeDbAll<T extends D1Row>(sql: string, params: unknown[], fallback: T[] = []) {
  try {
    return await dbAll<T>(sql, params);
  } catch (err) {
    if (isMissingSchemaError(err)) return fallback;
    throw err;
  }
}

async function safeDbFirst<T extends D1Row>(sql: string, params: unknown[], fallback: T | null = null) {
  try {
    return await dbFirst<T>(sql, params);
  } catch (err) {
    if (isMissingSchemaError(err)) return fallback;
    throw err;
  }
}

function normalizeRecipient(row: any): ConsultRecipient {
  return {
    id: String(row.id),
    full_name: row.full_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    role: row.role ?? null,
    avatar_url: row.avatar_url ?? null,
    last_message_at: row.last_message_at ?? null
  };
}

function isProfileActive(status: unknown) {
  const value = String(status ?? "").trim().toLowerCase();
  if (!value) return true;
  return value === "active";
}

function cloneRecipients(items: ConsultRecipient[]) {
  return items.map((item) => ({ ...item }));
}

function toRecipientCacheKey(user: SystemUserSafe) {
  return `${user.id}:${user.role}:${user.leader_id || ""}`;
}

function sweepRecipientCache(now: number) {
  if (!recipientCache.size) return;
  for (const [key, value] of recipientCache.entries()) {
    if (value.exp <= now) recipientCache.delete(key);
  }
  if (recipientCache.size <= RECIPIENT_CACHE_MAX_KEYS) return;
  const overflow = recipientCache.size - RECIPIENT_CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of recipientCache.keys()) {
    recipientCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function toCanConsultCacheKey(user: SystemUserSafe, targetId: string) {
  return `${user.id}:${user.role}:${user.leader_id || ""}:${targetId}`;
}

function sweepCanConsultCache(now: number) {
  if (!canConsultCache.size) return;
  for (const [key, value] of canConsultCache.entries()) {
    if (value.exp <= now) canConsultCache.delete(key);
  }
  if (canConsultCache.size <= CAN_CONSULT_CACHE_MAX_KEYS) return;
  const overflow = canConsultCache.size - CAN_CONSULT_CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of canConsultCache.keys()) {
    canConsultCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

async function fetchProfileRoleRow(profileId: string): Promise<ProfileRoleRow | null> {
  const withStatus = await safeDbFirst<ProfileRoleRow>(
    "select id, role, status from profiles where id = ? limit 1",
    [profileId],
    null
  );
  if (withStatus?.id) return withStatus;
  const legacy = await safeDbFirst<{ id: string; role: string | null }>(
    "select id, role from profiles where id = ? limit 1",
    [profileId],
    null
  );
  if (!legacy?.id) return null;
  return { ...legacy, status: "active" };
}

async function queryProfiles(
  whereSql: string,
  params: unknown[],
  limit = 1000
): Promise<ConsultRecipient[]> {
  for (const fields of PROFILE_FIELD_SETS) {
    const orderBy = fields.includes("created_at") ? "order by created_at desc" : "order by id desc";
    const sql = `select ${fields} from profiles ${whereSql} ${orderBy} limit ${limit}`;
    try {
      const rows = await dbAll(sql, params);
      return rows.filter((row: any) => isProfileActive(row?.status)).map(normalizeRecipient);
    } catch (error: any) {
      if (!isMissingSchemaError(error)) throw error;
    }
  }
  return [];
}

function parseTimestampToNumber(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return 0;

  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      if (numeric > 1e12) return Math.floor(numeric);
      if (numeric > 1e9) return Math.floor(numeric * 1000);
    }
  }

  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;

  // SQLite CURRENT_TIMESTAMP often uses "YYYY-MM-DD HH:MM:SS" format.
  const sqliteLike = raw.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (sqliteLike) {
    const normalized = `${sqliteLike[1]}T${sqliteLike[2]}Z`;
    const ts = Date.parse(normalized);
    if (Number.isFinite(ts)) return ts;
  }

  // ISO-like string without timezone suffix.
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && !/[zZ]|[+\-]\d{2}:?\d{2}$/.test(raw)) {
    const ts = Date.parse(`${raw}Z`);
    if (Number.isFinite(ts)) return ts;
  }

  // Legacy format such as "2026/03/01 22:18:00".
  const slashLike = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (slashLike) {
    const normalized = `${slashLike[1]}-${slashLike[2]}-${slashLike[3]}T${slashLike[4]}Z`;
    const ts = Date.parse(normalized);
    if (Number.isFinite(ts)) return ts;
  }

  return 0;
}

async function fetchProfilesByIds(ids: string[]) {
  if (!ids.length) return [];
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return [];
  const merged = new Map<string, ConsultRecipient>();
  for (const chunk of chunkIds(uniqueIds)) {
    const rows = await queryProfiles(`where id in (${sqlPlaceholders(chunk.length)})`, chunk, 1000);
    rows.forEach((row) => {
      if (!row?.id) return;
      merged.set(row.id, row);
    });
  }
  return Array.from(merged.values());
}

async function fetchSuperAdmins() {
  return queryProfiles("where role = ?", ["super_admin"], 50);
}

async function listConsultRecipientsUncached(ctx: SystemContext): Promise<ConsultRecipient[]> {
  const user = ctx.user;
  const unique = new Map<string, ConsultRecipient>();

  if (user.role === "super_admin") {
    const roles = CONTACTABLE_ROLES as unknown as string[];
    const rows = await queryProfiles(
      `where role in (${sqlPlaceholders(roles.length)})`,
      roles,
      1000
    );
    rows.forEach((row: any) => {
      if (!row?.id || row.id === user.id) return;
      unique.set(String(row.id), row);
    });
  } else if (user.role === "leader") {
    const supersPromise = fetchSuperAdmins();
    const treeIds = await fetchLeaderTreeIds(user.id);
    const ids = treeIds.filter((id) => id && id !== user.id);
    const rows = await fetchProfilesByIds(ids);
    rows.forEach((row) => {
      if (row.id === user.id) return;
      unique.set(row.id, row);
    });
    const supers = await supersPromise;
    supers.forEach((row) => {
      if (row.id === user.id) return;
      unique.set(row.id, row);
    });
  } else if (user.role === "coach") {
    const supersPromise = fetchSuperAdmins();
    const assigned = await safeDbAll<{ assigned_user_id: string | null }>(
      "select assigned_user_id from coach_assignments where coach_id = ?",
      [user.id],
      []
    );
    const ids = new Set<string>();
    assigned.forEach((row) => {
      if (row?.assigned_user_id) ids.add(String(row.assigned_user_id));
    });
    if (user.leader_id) ids.add(user.leader_id);
    const rows = await fetchProfilesByIds(Array.from(ids));
    rows.forEach((row) => {
      if (row.id === user.id) return;
      unique.set(row.id, row);
    });
    const supers = await supersPromise;
    supers.forEach((row) => {
      if (row.id === user.id) return;
      unique.set(row.id, row);
    });
  } else if (user.role === "assistant") {
    const supersPromise = fetchSuperAdmins();
    const createdIds = await fetchAssistantCreatedUserIds(user.id);
    const rows = await fetchProfilesByIds(createdIds);
    rows.forEach((row) => {
      if (row.id === user.id) return;
      unique.set(row.id, row);
    });
    if (user.leader_id) {
      const leaders = await fetchProfilesByIds([user.leader_id]);
      leaders.forEach((row) => {
        if (row.id === user.id) return;
        unique.set(row.id, row);
      });
    }
    const supers = await supersPromise;
    supers.forEach((row) => {
      if (row.id === user.id) return;
      unique.set(row.id, row);
    });
  } else {
    const supersPromise = fetchSuperAdmins();
    const ids = new Set<string>();
    if (user.leader_id) ids.add(user.leader_id);
    const selfRow = await safeDbFirst<{ created_by: string | null }>(
      "select created_by from profiles where id = ? limit 1",
      [user.id],
      null
    );
    if (selfRow?.created_by) {
      const creator = await fetchProfileRoleRow(String(selfRow.created_by));
      if (creator?.id && isProfileActive(creator.status) && String(creator.role || "") === "assistant") {
        ids.add(creator.id);
      }
    }
    const coaches = await safeDbAll<{ coach_id: string | null }>(
      "select coach_id from coach_assignments where assigned_user_id = ?",
      [user.id],
      []
    );
    coaches.forEach((row) => {
      if (row?.coach_id) ids.add(String(row.coach_id));
    });
    const rows = await fetchProfilesByIds(Array.from(ids));
    rows.forEach((row) => {
      if (row.id === user.id) return;
      unique.set(row.id, row);
    });
    const supers = await supersPromise;
    supers.forEach((row) => {
      if (row.id === user.id) return;
      unique.set(row.id, row);
    });
  }

  const recipients = Array.from(unique.values());
  const targetIds = recipients
    .filter((item) => item.role === "student" || item.role === "trader")
    .map((item) => item.id);
  if (targetIds.length) {
    try {
      const supportMap = await fetchStudentSupportNames(targetIds);
      recipients.forEach((item) => {
        const support = supportMap.get(item.id);
        if (!support) return;
        item.support_name = support.displayName || null;
        item.assistant_name = support.assistantName || null;
        item.coach_name = support.coachName || null;
      });
    } catch (error) {
      console.warn("[consult/recipients] resolve support names failed", error);
      // tolerate missing support tables during migration
    }
  }

  try {
    const peerIds = recipients.map((item) => item.id).filter(Boolean);
    if (peerIds.length) {
      const latestByPeer = await mapConsultLatestByPeerIds(user.id, peerIds);
      recipients.forEach((item) => {
        item.last_message_at = latestByPeer[item.id] || null;
      });
    }
  } catch {
    // tolerate latest-time query failures and keep fallback sort.
  }

  return recipients.sort((a, b) => {
    const latestA = parseTimestampToNumber(a.last_message_at);
    const latestB = parseTimestampToNumber(b.last_message_at);
    if (latestA !== latestB) return latestB - latestA;
    const nameA = (a.full_name || a.email || "").toLowerCase();
    const nameB = (b.full_name || b.email || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

export async function listConsultRecipients(
  ctx: SystemContext,
  options: { bypassCache?: boolean } = {}
): Promise<ConsultRecipient[]> {
  const bypassCache = Boolean(options.bypassCache);
  const cacheKey = toRecipientCacheKey(ctx.user);
  const now = Date.now();

  if (!bypassCache) {
    sweepRecipientCache(now);
    const cached = recipientCache.get(cacheKey);
    if (cached && cached.exp > now) return cloneRecipients(cached.items);

    const pending = recipientInflight.get(cacheKey);
    if (pending) {
      const items = await pending;
      return cloneRecipients(items);
    }
  }

  const task = listConsultRecipientsUncached(ctx);
  if (!bypassCache) recipientInflight.set(cacheKey, task);
  try {
    const items = await task;
    if (!bypassCache) {
      recipientCache.set(cacheKey, { exp: Date.now() + RECIPIENT_CACHE_TTL_MS, items });
    }
    return cloneRecipients(items);
  } finally {
    if (!bypassCache) recipientInflight.delete(cacheKey);
  }
}

function chunkIds(ids: string[], size = MAX_IN_CLAUSE_SIZE) {
  const out: string[][] = [];
  if (!ids.length) return out;
  for (let index = 0; index < ids.length; index += size) {
    out.push(ids.slice(index, index + size));
  }
  return out;
}

function consultRetentionCutoffIso() {
  return new Date(Date.now() - CONSULT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function countConsultUnreadByPeerIds(userId: string, peerIds: string[]) {
  if (!userId || !peerIds.length) return 0;
  const cutoff = consultRetentionCutoffIso();
  let total = 0;
  for (const chunk of chunkIds(peerIds)) {
    const row = await dbFirst<{ total: number | null }>(
      [
        "select count(1) as total",
        "from consult_messages",
        "where to_user_id = ? and read_at is null and created_at >= ?",
        `and from_user_id in (${sqlPlaceholders(chunk.length)})`
      ].join(" "),
      [userId, cutoff, ...chunk]
    );
    total += Number(row?.total || 0);
  }
  return total;
}

export async function mapConsultUnreadByPeerIds(userId: string, peerIds: string[]) {
  const counts: Record<string, number> = {};
  if (!userId || !peerIds.length) return counts;
  const cutoff = consultRetentionCutoffIso();

  for (const chunk of chunkIds(peerIds)) {
    const rows = await dbAll<{ from_user_id: string | null; total: number | null }>(
      [
        "select from_user_id, count(1) as total",
        "from consult_messages",
        "where to_user_id = ? and read_at is null and created_at >= ?",
        `and from_user_id in (${sqlPlaceholders(chunk.length)})`,
        "group by from_user_id"
      ].join(" "),
      [userId, cutoff, ...chunk]
    );
    (rows || []).forEach((row) => {
      const id = String(row.from_user_id || "");
      if (!id) return;
      counts[id] = Number(row.total || 0);
    });
  }

  return counts;
}

export async function mapConsultLatestByPeerIds(userId: string, peerIds: string[]) {
  const latest: Record<string, string> = {};
  if (!userId || !peerIds.length) return latest;
  const cutoff = consultRetentionCutoffIso();

  for (const chunk of chunkIds(peerIds)) {
    let rows: Array<{ peer_id: string | null; latest_at: string | null }> = [];
    try {
      rows = await dbAll<{ peer_id: string | null; latest_at: string | null }>(
        [
          "select peer_id, max(created_at) as latest_at",
          "from (",
          "select to_user_id as peer_id, created_at from consult_messages where from_user_id = ? and created_at >= ?",
          "union all",
          "select from_user_id as peer_id, created_at from consult_messages where to_user_id = ? and created_at >= ?",
          ") as convo",
          `where peer_id in (${sqlPlaceholders(chunk.length)})`,
          "group by peer_id"
        ].join(" "),
        [userId, cutoff, userId, cutoff, ...chunk]
      );
    } catch (error: any) {
      if (isMissingSchemaError(error)) return latest;
      // Keep partial latest map on transient DB errors (e.g. 429/503).
      continue;
    }
    (rows || []).forEach((row) => {
      const peerId = String(row.peer_id || "");
      if (!peerId) return;
      const latestAtRaw = String(row.latest_at || "").trim();
      const createdAt = latestAtRaw;
      if (!createdAt) return;
      const previous = latest[peerId];
      if (!previous || parseTimestampToNumber(createdAt) >= parseTimestampToNumber(previous)) {
        latest[peerId] = createdAt;
      }
    });
  }

  return latest;
}

async function canConsultWithUncached(ctx: SystemContext, targetId: string): Promise<boolean> {
  const user = ctx.user;
  if (!targetId || targetId === user.id) return false;

  const target = await fetchProfileRoleRow(targetId);
  if (!target?.id) return false;
  if (!isProfileActive(target.status)) return false;
  const targetRole = String(target.role || "");

  if (user.role === "super_admin") {
    return CONTACTABLE_ROLES.includes(targetRole as any);
  }

  if (targetRole === "super_admin") return true;

  if (user.role === "leader") {
    const treeIds = await fetchLeaderTreeIds(user.id);
    return treeIds.includes(targetId) && targetId !== user.id;
  }

  if (user.role === "coach") {
    if (user.leader_id && targetId === user.leader_id) return true;
    const assigned = await safeDbAll<{ assigned_user_id: string | null }>(
      "select assigned_user_id from coach_assignments where coach_id = ?",
      [user.id],
      []
    );
    return assigned.some((row) => String(row.assigned_user_id || "") === targetId);
  }

  if (user.role === "assistant") {
    if (user.leader_id && targetId === user.leader_id) return true;
    const created = await safeDbFirst<{ id: string }>(
      "select id from profiles where created_by = ? and id = ? limit 1",
      [user.id, targetId],
      null
    );
    return Boolean(created?.id);
  }

  if (user.leader_id && targetId === user.leader_id) return true;
  const selfRow = await safeDbFirst<{ created_by: string | null }>(
    "select created_by from profiles where id = ? limit 1",
    [user.id],
    null
  );
  if (selfRow?.created_by && String(selfRow.created_by) === targetId) {
    const creator = await fetchProfileRoleRow(targetId);
    if (creator?.id && isProfileActive(creator.status) && String(creator.role || "") === "assistant") return true;
  }
  const coaches = await safeDbAll<{ coach_id: string | null }>(
    "select coach_id from coach_assignments where assigned_user_id = ?",
    [user.id],
    []
  );
  return coaches.some((row) => String(row.coach_id || "") === targetId);
}

export async function canConsultWith(
  ctx: SystemContext,
  targetId: string,
  options: { bypassCache?: boolean } = {}
): Promise<boolean> {
  const user = ctx.user;
  if (!targetId || targetId === user.id) return false;
  const bypassCache = Boolean(options.bypassCache);
  const cacheKey = toCanConsultCacheKey(user, targetId);
  const now = Date.now();

  if (!bypassCache) {
    sweepCanConsultCache(now);
    const cached = canConsultCache.get(cacheKey);
    if (cached && cached.exp > now) return Boolean(cached.value);
    const pending = canConsultInflight.get(cacheKey);
    if (pending) return await pending;
  }

  const task = canConsultWithUncached(ctx, targetId);
  if (!bypassCache) canConsultInflight.set(cacheKey, task);
  try {
    const value = await task;
    if (!bypassCache) {
      canConsultCache.set(cacheKey, {
        exp: Date.now() + CAN_CONSULT_CACHE_TTL_MS,
        value
      });
    }
    return value;
  } finally {
    if (!bypassCache) canConsultInflight.delete(cacheKey);
  }
}


