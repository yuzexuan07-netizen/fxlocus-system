import { NextRequest, NextResponse } from "next/server";

import { requireSystemUser } from "@/lib/system/guard";
import { listConsultRecipients, mapConsultUnreadByPeerIds } from "@/lib/system/consult";
import { mapSystemApiError } from "@/lib/system/apiError";
import { isMissingSchemaError } from "@/lib/system/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 1_500;
const CACHE_MAX_KEYS = 1_000;
const g = globalThis as {
  __fx_consult_unread_by_peer_cache?: Map<
    string,
    { exp: number; payload: { ok: true; counts: Record<string, number>; latest: Record<string, string> } }
  >;
  __fx_consult_unread_by_peer_inflight?: Map<string, Promise<{ ok: true; counts: Record<string, number>; latest: Record<string, string> }>>;
};
if (!g.__fx_consult_unread_by_peer_cache) g.__fx_consult_unread_by_peer_cache = new Map();
if (!g.__fx_consult_unread_by_peer_inflight) g.__fx_consult_unread_by_peer_inflight = new Map();
const unreadByPeerCache = g.__fx_consult_unread_by_peer_cache;
const unreadByPeerInflight = g.__fx_consult_unread_by_peer_inflight;

function sweepUnreadByPeerCache(now: number) {
  if (!unreadByPeerCache.size) return;
  for (const [key, value] of unreadByPeerCache.entries()) {
    if (value.exp <= now) unreadByPeerCache.delete(key);
  }
  if (unreadByPeerCache.size <= CACHE_MAX_KEYS) return;
  const overflow = unreadByPeerCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of unreadByPeerCache.keys()) {
    unreadByPeerCache.delete(key);
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

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSystemUser();
    const { user } = ctx;
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const now = Date.now();
    if (!fresh) {
      sweepUnreadByPeerCache(now);
      const cached = unreadByPeerCache.get(user.id);
      if (cached && cached.exp > now) {
        return json(cached.payload);
      }
    }
    const inflightKey = fresh ? `${user.id}:fresh` : user.id;
    let task = unreadByPeerInflight.get(inflightKey);
    if (!task) {
      task = (async () => {
        const recipientItems = await listConsultRecipients(ctx, { bypassCache: fresh });
        const allowedPeerIds = recipientItems.map((item) => item.id).filter(Boolean);
        if (!allowedPeerIds.length) return { ok: true, counts: {}, latest: {} } as const;

        const latestFromRecipients: Record<string, string> = {};
        recipientItems.forEach((item) => {
          const value = String(item?.last_message_at || "").trim();
          if (value) latestFromRecipients[item.id] = value;
        });

        let counts: Record<string, number> = {};
        try {
          counts = await mapConsultUnreadByPeerIds(user.id, allowedPeerIds);
        } catch (err) {
          if (!isMissingSchemaError(err)) throw err;
          return { ok: true, counts: {}, latest: latestFromRecipients } as const;
        }
        return { ok: true, counts, latest: latestFromRecipients } as const;
      })();
      unreadByPeerInflight.set(inflightKey, task);
    }
    const payload = await task.finally(() => unreadByPeerInflight.delete(inflightKey));
    unreadByPeerCache.set(user.id, { exp: Date.now() + (fresh ? 700 : CACHE_TTL_MS), payload });
    return json(payload);
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    // Keep consult UI stable during transient DB/back-end issues.
    if (mapped.status >= 500) {
      return json({ ok: true, counts: {}, latest: {} });
    }
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
