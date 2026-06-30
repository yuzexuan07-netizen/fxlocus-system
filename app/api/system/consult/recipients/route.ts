import { NextRequest, NextResponse } from "next/server";

import { listConsultRecipients } from "@/lib/system/consult";
import { mapSystemApiError } from "@/lib/system/apiError";
import { requireSystemUser } from "@/lib/system/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 20_000;
const CACHE_MAX_KEYS = 320;
type RecipientsPayload = { ok: true; items: unknown[] };
const g = globalThis as {
  __fx_consult_recipients_route_cache?: Map<string, { exp: number; payload: RecipientsPayload }>;
  __fx_consult_recipients_route_inflight?: Map<string, Promise<RecipientsPayload>>;
};
if (!g.__fx_consult_recipients_route_cache) g.__fx_consult_recipients_route_cache = new Map();
if (!g.__fx_consult_recipients_route_inflight) g.__fx_consult_recipients_route_inflight = new Map();
const recipientsRouteCache = g.__fx_consult_recipients_route_cache;
const recipientsRouteInflight = g.__fx_consult_recipients_route_inflight;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function sweepRecipientsRouteCache(now: number) {
  if (!recipientsRouteCache.size) return;
  for (const [key, value] of recipientsRouteCache.entries()) {
    if (value.exp <= now) recipientsRouteCache.delete(key);
  }
  if (recipientsRouteCache.size <= CACHE_MAX_KEYS) return;
  const overflow = recipientsRouteCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of recipientsRouteCache.keys()) {
    recipientsRouteCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export async function GET(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireSystemUser>>;
  try {
    ctx = await requireSystemUser();
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    if (mapped.code === "UNAUTHORIZED" || mapped.code === "FORBIDDEN" || mapped.code === "FROZEN") {
      return json({ ok: false, error: mapped.code }, mapped.status);
    }
    // Keep consult UI recoverable on transient DB/server failures.
    return json({ ok: true, items: [] as unknown[] });
  }

  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const cacheKey = ctx.user.id;
  const now = Date.now();
  sweepRecipientsRouteCache(now);

  if (!fresh) {
    const cached = recipientsRouteCache.get(cacheKey);
    if (cached && cached.exp > now) return json(cached.payload);
  }

  let task = recipientsRouteInflight.get(cacheKey);
  if (!task) {
    task = (async () => {
      const items = await listConsultRecipients(ctx, { bypassCache: fresh });
      return { ok: true, items } as RecipientsPayload;
    })();
    recipientsRouteInflight.set(cacheKey, task);
  }

  try {
    const payload = await task;
    recipientsRouteCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
    return json(payload);
  } catch {
    const cached = recipientsRouteCache.get(cacheKey);
    if (cached && cached.exp > Date.now()) return json(cached.payload);
    // Keep consult UI recoverable on transient DB/server failures.
    return json({ ok: true, items: [] as unknown[], transient: true });
  } finally {
    recipientsRouteInflight.delete(cacheKey);
  }
}
