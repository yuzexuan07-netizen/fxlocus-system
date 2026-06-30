import { dbFirst, dbRun } from "@/lib/d1";

type BucketEntry = {
  count: number;
  resetAt: number;
};

type LimitResult = {
  limited: boolean;
  retryAfterSec: number;
};

type ConsumeLoginAttemptResult = {
  limited: boolean;
  retryAfterSec: number;
  ip: string;
  email: string;
  store: "memory" | "d1";
};

function readEnvNumber(key: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const raw = Number(process.env[key] || "");
  if (!Number.isFinite(raw)) return fallback;
  const normalized = Math.floor(raw);
  if (normalized < min || normalized > max) return fallback;
  return normalized;
}

const WINDOW_MS = readEnvNumber("LOGIN_RATE_LIMIT_WINDOW_MS", 10 * 60 * 1000, 10_000, 60 * 60 * 1000);
const MAX_ATTEMPTS_PER_IP = readEnvNumber(
  "LOGIN_RATE_LIMIT_MAX_ATTEMPTS_IP",
  readEnvNumber("LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_IP", 60, 5, 10_000),
  5,
  10_000
);
const MAX_ATTEMPTS_PER_EMAIL = readEnvNumber(
  "LOGIN_RATE_LIMIT_MAX_ATTEMPTS_EMAIL",
  readEnvNumber("LOGIN_RATE_LIMIT_MAX_ATTEMPTS_PER_EMAIL", 10, 3, 2000),
  3,
  2000
);
const SWEEP_INTERVAL_MS = 30_000;
const MAX_IP_BUCKETS = 30_000;
const MAX_EMAIL_BUCKETS = 30_000;
const PERSIST_SWEEP_INTERVAL_MS = 60_000;
const PERSIST_MAX_ROWS = 120_000;
const USE_PERSISTENT_STORE = String(process.env.LOGIN_RATE_LIMIT_STORE || "d1").toLowerCase() !== "memory";

const ipBuckets = new Map<string, BucketEntry>();
const emailBuckets = new Map<string, BucketEntry>();
let lastSweepAt = 0;
let lastPersistentSweepAt = 0;

function normalizeIp(raw: string | null | undefined) {
  const input = String(raw || "").trim();
  return input || "unknown";
}

function normalizeEmail(raw: string | null | undefined) {
  return String(raw || "").trim().toLowerCase();
}

function getIpFromHeaders(headers: Headers) {
  const xff = String(headers.get("x-forwarded-for") || "").trim();
  if (xff) return normalizeIp(xff.split(",")[0]?.trim());
  const realIp = String(headers.get("x-real-ip") || "").trim();
  if (realIp) return normalizeIp(realIp);
  return "unknown";
}

function ipBucketKey(ip: string) {
  return `ip:${ip}`;
}

function emailBucketKey(email: string) {
  return `email:${email}`;
}

function maybeSweepMemory(now: number) {
  const shouldSweep =
    now - lastSweepAt >= SWEEP_INTERVAL_MS ||
    ipBuckets.size > MAX_IP_BUCKETS ||
    emailBuckets.size > MAX_EMAIL_BUCKETS;
  if (!shouldSweep) return;
  lastSweepAt = now;

  for (const [key, entry] of ipBuckets.entries()) {
    if (entry.resetAt <= now) ipBuckets.delete(key);
  }
  for (const [key, entry] of emailBuckets.entries()) {
    if (entry.resetAt <= now) emailBuckets.delete(key);
  }

  if (ipBuckets.size > MAX_IP_BUCKETS) {
    const overflow = ipBuckets.size - MAX_IP_BUCKETS;
    let removed = 0;
    for (const key of ipBuckets.keys()) {
      ipBuckets.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }

  if (emailBuckets.size > MAX_EMAIL_BUCKETS) {
    const overflow = emailBuckets.size - MAX_EMAIL_BUCKETS;
    let removed = 0;
    for (const key of emailBuckets.keys()) {
      emailBuckets.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }
}

function consumeMemoryBucket(
  map: Map<string, BucketEntry>,
  key: string,
  limit: number,
  now: number
): LimitResult {
  const current = map.get(key);
  if (!current || current.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { limited: false, retryAfterSec: 0 };
  }
  current.count += 1;
  map.set(key, current);
  if (current.count <= limit) return { limited: false, retryAfterSec: 0 };
  return {
    limited: true,
    retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  };
}

async function consumePersistentBucket(key: string, limit: number, now: number): Promise<LimitResult> {
  const resetAt = now + WINDOW_MS;
  await dbRun(
    [
      "insert into login_rate_limits (key, count, reset_at_ms, updated_at)",
      "values (?, 1, ?, CURRENT_TIMESTAMP)",
      "on conflict(key) do update set",
      "count = case when login_rate_limits.reset_at_ms <= ? then 1 else login_rate_limits.count + 1 end,",
      "reset_at_ms = case when login_rate_limits.reset_at_ms <= ? then excluded.reset_at_ms else login_rate_limits.reset_at_ms end,",
      "updated_at = CURRENT_TIMESTAMP"
    ].join(" "),
    [key, resetAt, now, now]
  );

  const row = await dbFirst<{ count: number | null; reset_at_ms: number | null }>(
    "select count, reset_at_ms from login_rate_limits where key = ? limit 1",
    [key]
  );
  const count = Number(row?.count || 0);
  const resetAtMs = Number(row?.reset_at_ms || resetAt);
  if (count <= limit) return { limited: false, retryAfterSec: 0 };
  return {
    limited: true,
    retryAfterSec: Math.max(1, Math.ceil((resetAtMs - now) / 1000))
  };
}

async function maybeSweepPersistent(now: number) {
  if (now - lastPersistentSweepAt < PERSIST_SWEEP_INTERVAL_MS) return;
  lastPersistentSweepAt = now;

  await dbRun("delete from login_rate_limits where reset_at_ms <= ?", [now]);
  const sizeRow = await dbFirst<{ total: number | null }>("select count(1) as total from login_rate_limits");
  const total = Number(sizeRow?.total || 0);
  if (total <= PERSIST_MAX_ROWS) return;
  const overflow = total - PERSIST_MAX_ROWS;
  await dbRun(
    [
      "delete from login_rate_limits",
      "where key in (",
      "select key from login_rate_limits order by updated_at asc limit ?",
      ")"
    ].join(" "),
    [overflow]
  );
}

async function clearPersistentBucket(key: string) {
  await dbRun("delete from login_rate_limits where key = ?", [key]);
}

function clearMemoryBucket(map: Map<string, BucketEntry>, key: string) {
  if (!key) return;
  map.delete(key);
}

function composeResult(
  ip: string,
  email: string,
  ipResult: LimitResult,
  emailResult: LimitResult,
  store: "memory" | "d1"
): ConsumeLoginAttemptResult {
  if (!ipResult.limited && !emailResult.limited) {
    return { limited: false, retryAfterSec: 0, ip, email, store };
  }
  return {
    limited: true,
    retryAfterSec: Math.max(ipResult.retryAfterSec, emailResult.retryAfterSec),
    ip,
    email,
    store
  };
}

export async function consumeLoginAttempt(
  headers: Headers,
  email: string
): Promise<ConsumeLoginAttemptResult> {
  const now = Date.now();
  maybeSweepMemory(now);

  const ip = normalizeIp(getIpFromHeaders(headers));
  const normalizedEmail = normalizeEmail(email);

  const memoryIpResult = consumeMemoryBucket(ipBuckets, ip, MAX_ATTEMPTS_PER_IP, now);
  const memoryEmailResult = consumeMemoryBucket(emailBuckets, normalizedEmail, MAX_ATTEMPTS_PER_EMAIL, now);
  const memoryResult = composeResult(ip, normalizedEmail, memoryIpResult, memoryEmailResult, "memory");

  if (!USE_PERSISTENT_STORE) return memoryResult;

  try {
    await maybeSweepPersistent(now);
    const [d1IpResult, d1EmailResult] = await Promise.all([
      consumePersistentBucket(ipBucketKey(ip), MAX_ATTEMPTS_PER_IP, now),
      consumePersistentBucket(emailBucketKey(normalizedEmail), MAX_ATTEMPTS_PER_EMAIL, now)
    ]);
    return composeResult(ip, normalizedEmail, d1IpResult, d1EmailResult, "d1");
  } catch {
    return memoryResult;
  }
}

export async function clearLoginAttempts(ip: string, email: string) {
  const normalizedIp = normalizeIp(ip);
  const normalizedEmail = normalizeEmail(email);

  clearMemoryBucket(ipBuckets, normalizedIp);
  clearMemoryBucket(emailBuckets, normalizedEmail);

  if (!USE_PERSISTENT_STORE) return;
  await Promise.allSettled([
    clearPersistentBucket(ipBucketKey(normalizedIp)),
    clearPersistentBucket(emailBucketKey(normalizedEmail))
  ]);
}

export function getLoginRateLimitConfig() {
  return {
    windowMs: WINDOW_MS,
    maxAttemptsPerIp: MAX_ATTEMPTS_PER_IP,
    maxAttemptsPerEmail: MAX_ATTEMPTS_PER_EMAIL,
    store: USE_PERSISTENT_STORE ? "d1" : "memory"
  };
}
