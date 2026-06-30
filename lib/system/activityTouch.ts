import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { dbRun } from "@/lib/d1";

const TOUCH_TTL_MS = 10 * 60 * 1000;
const TOUCH_CACHE_MAX_KEYS = 4_000;

const g = globalThis as {
  __fx_profile_activity_touch_until?: Map<string, number>;
  __fx_profile_activity_touch_inflight?: Set<string>;
};

if (!g.__fx_profile_activity_touch_until) g.__fx_profile_activity_touch_until = new Map();
if (!g.__fx_profile_activity_touch_inflight) g.__fx_profile_activity_touch_inflight = new Set();

const touchUntilCache = g.__fx_profile_activity_touch_until;
const touchInflight = g.__fx_profile_activity_touch_inflight;

function sweepTouchCache(now: number) {
  if (!touchUntilCache.size) return;
  for (const [key, value] of touchUntilCache.entries()) {
    if (value <= now) touchUntilCache.delete(key);
  }
  if (touchUntilCache.size <= TOUCH_CACHE_MAX_KEYS) return;
  const overflow = touchUntilCache.size - TOUCH_CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of touchUntilCache.keys()) {
    touchUntilCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export function touchProfileActivity(userId: string | null | undefined) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return;

  const now = Date.now();
  sweepTouchCache(now);

  const touchedUntil = Number(touchUntilCache.get(normalizedUserId) || 0);
  if (touchedUntil > now || touchInflight.has(normalizedUserId)) return;

  touchUntilCache.set(normalizedUserId, now + TOUCH_TTL_MS);
  touchInflight.add(normalizedUserId);

  const touchedAt = new Date(now).toISOString();
  const task = dbRun("update profiles set last_login_at = ? where id = ?", [touchedAt, normalizedUserId])
    .catch(() => {
      touchUntilCache.delete(normalizedUserId);
    })
    .finally(() => {
      touchInflight.delete(normalizedUserId);
    });

  void (async () => {
    try {
      const { ctx } = await getCloudflareContext({ async: true });
      ctx.waitUntil(task);
    } catch {
      void task;
    }
  })();
}
