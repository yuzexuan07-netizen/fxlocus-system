import { NextResponse } from "next/server";

import { requireSystemUser } from "@/lib/system/guard";
import { countConsultUnreadByPeerIds, listConsultRecipients } from "@/lib/system/consult";
import { mapSystemApiError } from "@/lib/system/apiError";
import { isMissingSchemaError } from "@/lib/system/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 1_500;
const CACHE_MAX_KEYS = 1_000;
const g = globalThis as {
  __fx_consult_unread_count_cache?: Map<string, { exp: number; payload: { ok: true; count: number } }>;
  __fx_consult_unread_count_inflight?: Map<string, Promise<{ ok: true; count: number }>>;
};
if (!g.__fx_consult_unread_count_cache) g.__fx_consult_unread_count_cache = new Map();
if (!g.__fx_consult_unread_count_inflight) g.__fx_consult_unread_count_inflight = new Map();
const unreadCountCache = g.__fx_consult_unread_count_cache;
const unreadCountInflight = g.__fx_consult_unread_count_inflight;

function sweepUnreadCountCache(now: number) {
  if (!unreadCountCache.size) return;
  for (const [key, value] of unreadCountCache.entries()) {
    if (value.exp <= now) unreadCountCache.delete(key);
  }
  if (unreadCountCache.size <= CACHE_MAX_KEYS) return;
  const overflow = unreadCountCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of unreadCountCache.keys()) {
    unreadCountCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function GET() {
  try {
    const ctx = await requireSystemUser();
    const { user } = ctx;
    const now = Date.now();
    sweepUnreadCountCache(now);
    const cached = unreadCountCache.get(user.id);
    if (cached && cached.exp > now) {
      return json(cached.payload);
    }
    let task = unreadCountInflight.get(user.id);
    if (!task) {
      task = (async () => {
        const recipientItems = await listConsultRecipients(ctx);
        const allowedPeerIds = recipientItems.map((item) => item.id).filter(Boolean);
        if (!allowedPeerIds.length) return { ok: true, count: 0 } as const;
        try {
          const count = await countConsultUnreadByPeerIds(user.id, allowedPeerIds);
          return { ok: true, count } as const;
        } catch (err) {
          if (isMissingSchemaError(err)) {
            return { ok: true, count: 0 } as const;
          }
          throw err;
        }
      })();
      unreadCountInflight.set(user.id, task);
    }
    const payload = await task.finally(() => unreadCountInflight.delete(user.id));
    unreadCountCache.set(user.id, { exp: Date.now() + CACHE_TTL_MS, payload });
    return json(payload);
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    if (mapped.code === "UNAUTHORIZED" || mapped.code === "FORBIDDEN" || mapped.code === "FROZEN") {
      return json({ ok: false, error: mapped.code }, mapped.status);
    }
    return json({ ok: true, count: 0, transient: true });
  }
}
