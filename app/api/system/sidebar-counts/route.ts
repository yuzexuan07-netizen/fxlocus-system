import { NextRequest, NextResponse } from "next/server";

import { dbFirst } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { requireSystemUser } from "@/lib/system/guard";
import type { SystemUserSafe } from "@/lib/system/guard";
import { countConsultUnreadByPeerIds, listConsultRecipients } from "@/lib/system/consult";
import { getPendingCounts } from "@/lib/system/pendingCounts";
import { materializePinnedNotificationsForUser } from "@/lib/system/pinnedNotifications";
import { isAdminRole } from "@/lib/system/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 1_200;
const FRESH_BURST_TTL_MS = 300;
const CACHE_MAX_KEYS = 480;
const STALE_GRACE_MS = 20_000;
type SidebarCountsPayload = {
  ok: true;
  unread: number;
  consultUnread: number;
  pending: Record<string, number>;
};
const g = globalThis as {
  __fx_sidebar_counts_cache?: Map<
    string,
    {
      exp: number;
      at: number;
      payload: SidebarCountsPayload;
    }
  >;
  __fx_sidebar_counts_inflight?: Map<string, Promise<SidebarCountsPayload>>;
};
if (!g.__fx_sidebar_counts_cache) g.__fx_sidebar_counts_cache = new Map();
if (!g.__fx_sidebar_counts_inflight) g.__fx_sidebar_counts_inflight = new Map();
const sidebarCountsCache = g.__fx_sidebar_counts_cache;
const sidebarCountsInflight = g.__fx_sidebar_counts_inflight;

function sweepSidebarCache(now: number) {
  if (!sidebarCountsCache.size) return;
  for (const [key, value] of sidebarCountsCache.entries()) {
    if (value.exp <= now) sidebarCountsCache.delete(key);
  }
  if (sidebarCountsCache.size <= CACHE_MAX_KEYS) return;
  const overflow = sidebarCountsCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of sidebarCountsCache.keys()) {
    sidebarCountsCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function findReusableSidebarPayload(cacheKey: string) {
  const entry = sidebarCountsCache.get(cacheKey);
  if (!entry) return null;
  const now = Date.now();
  if (entry.exp > now) return entry.payload;
  if (entry.exp + STALE_GRACE_MS > now) return entry.payload;
  return null;
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

async function computeSidebarCounts(
  user: SystemUserSafe,
  options: { bypassInnerCache: boolean }
) {
  const safeResolve = async <T>(task: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await task();
    } catch {
      return fallback;
    }
  };
  const bypassInnerCache = Boolean(options.bypassInnerCache);
  await safeResolve(() => materializePinnedNotificationsForUser(user.id), 0);
  const notificationPromise = safeResolve(
    () =>
      dbFirst<{ total: number }>(
        [
          "select count(1) as total from notifications",
          "where to_user_id = ? and read_at is null",
          "and not (title = ? and content like ?)"
        ].join(" "),
        [user.id, "安全提醒", "检测到新的登录设备。%"]
      ),
    null as { total: number } | null
  );
  const recipientsPromise = safeResolve(
    () => listConsultRecipients({ user, db: null }, { bypassCache: bypassInnerCache }),
    [] as Awaited<ReturnType<typeof listConsultRecipients>>
  );
  const pendingPromise =
    isAdminRole(user.role) || user.role === "coach" || user.role === "assistant"
      ? safeResolve<Awaited<ReturnType<typeof getPendingCounts>> | null>(
          () => getPendingCounts({ user, bypassCache: bypassInnerCache }),
          null
        )
      : Promise.resolve(null);
  const deviceLoginNotificationPromise = safeResolve(
    () =>
      dbFirst<{ total: number }>(
        [
          "select count(1) as total from notifications",
          "where to_user_id = ? and read_at is null",
          "and title = ? and content like ?"
        ].join(" "),
        [user.id, "安全提醒", "检测到新的登录设备。%"]
      ),
    null as { total: number } | null
  );

  const [notificationRow, deviceLoginNotificationRow, recipientItems, pendingRes] = await Promise.all([
    notificationPromise,
    deviceLoginNotificationPromise,
    recipientsPromise,
    pendingPromise
  ]);
  const peerIds = recipientItems.map((item) => item.id).filter(Boolean);
  const consultUnread = peerIds.length
    ? await safeResolve(() => countConsultUnreadByPeerIds(user.id, peerIds), 0)
    : 0;

  return {
    ok: true,
    unread: Math.max(0, Number(notificationRow?.total || 0) - Number(deviceLoginNotificationRow?.total || 0)),
    consultUnread,
    pending: (pendingRes?.counts || {}) as Record<string, number>
  } as const;
}

export async function GET(req: NextRequest) {
  let cacheKeyForFallback = "";
  let hardFreshRequested = false;
  try {
    const { user } = await requireSystemUser();
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const hardFresh = fresh && req.nextUrl.searchParams.get("hard") === "1";
    hardFreshRequested = hardFresh;
    const now = Date.now();
    const cacheKey = `${user.id}:${user.role}`;
    cacheKeyForFallback = cacheKey;
    const inflightKey = `${cacheKey}:${fresh ? (hardFresh ? "fresh-hard" : "fresh-soft") : "normal"}`;
    const cached = sidebarCountsCache.get(cacheKey);
    if (!fresh) {
      sweepSidebarCache(now);
      if (cached && cached.exp > now) {
        return json(cached.payload);
      }
    } else if (!hardFresh && cached && now - cached.at <= FRESH_BURST_TTL_MS) {
      // Prevent burst refresh storms from hammering D1 while keeping near-realtime updates.
      return json(cached.payload);
    }

    let task = sidebarCountsInflight.get(inflightKey);
    if (!task) {
      task = computeSidebarCounts(user, { bypassInnerCache: fresh });
      sidebarCountsInflight.set(inflightKey, task);
    }
    const payload = await task.finally(() => {
      sidebarCountsInflight.delete(inflightKey);
    });
    sidebarCountsCache.set(cacheKey, { exp: now + (fresh ? 400 : CACHE_TTL_MS), at: now, payload });

    return json(payload);
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    if (mapped.code === "UNAUTHORIZED" || mapped.code === "FORBIDDEN" || mapped.code === "FROZEN") {
      return json({ ok: false, error: mapped.code }, mapped.status);
    }
    if (hardFreshRequested) {
      return json({ ok: false, error: "TRANSIENT" }, 503);
    }
    if (cacheKeyForFallback) {
      const cached = findReusableSidebarPayload(cacheKeyForFallback);
      if (cached) return json({ ...cached, transient: true });
    }
    return json({ ok: true, unread: 0, consultUnread: 0, pending: {}, transient: true });
  }
}
