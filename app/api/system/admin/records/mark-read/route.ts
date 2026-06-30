import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdmin } from "@/lib/system/guard";
import { dbFirst, dbRun } from "@/lib/d1";
import { upsertAdminRecordReadMark } from "@/lib/system/adminRecordReadMarks";
import { invalidateSidebarCountsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

const TypeParam = z.enum(["donate", "contact", "enrollment"]);

function isMissingSchemaError(err: any) {
  const message = String(err?.message || "").toLowerCase();
  return message.includes("no such table") || message.includes("no such column");
}

function invalidateRecordsListCache(recordType: "donate" | "contact" | "enrollment") {
  const g = globalThis as {
    __fx_admin_records_list_cache?: Map<string, { exp: number; payload: unknown }>;
    __fx_admin_records_list_inflight?: Map<string, Promise<unknown>>;
  };
  const cache = g.__fx_admin_records_list_cache;
  const inflight = g.__fx_admin_records_list_inflight;
  if (cache) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${recordType}:`)) {
        cache.delete(key);
      }
    }
  }
  if (inflight) {
    for (const key of inflight.keys()) {
      if (key.startsWith(`${recordType}:`)) {
        inflight.delete(key);
      }
    }
  }
}

export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
    const body = (await req.json().catch(() => null)) as { id?: string; type?: string } | null;
    const id = String(body?.id || "").trim();
    const parsedType = TypeParam.safeParse(String(body?.type || "").trim().toLowerCase());
    const fallbackType = parsedType.success ? parsedType.data : "contact";
    if (!id) return json({ ok: false, error: "INVALID_ID" }, 400);

    const now = new Date().toISOString();
    let recordType: "donate" | "contact" | "enrollment" = fallbackType;
    let found = false;

    try {
      const existing = await dbFirst<{ id: string; type: string | null }>(
        "select id, type from records where id = ? limit 1",
        [id]
      );
      if (existing?.id) {
        found = true;
        if (TypeParam.safeParse(existing.type || "").success) {
          recordType = existing.type as "donate" | "contact" | "enrollment";
        }
        try {
          await dbRun("update records set read_at = ? where id = ?", [now, id]);
        } catch (err) {
          if (!isMissingSchemaError(err)) throw err;
        }
      }
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }

    if (!found && recordType === "contact") {
      try {
        const contact = await dbFirst<{ id: string }>(
          "select id from contact_submissions where id = ? limit 1",
          [id]
        );
        found = Boolean(contact?.id);
      } catch (err) {
        if (!isMissingSchemaError(err)) throw err;
      }
    }

    if (!found) return json({ ok: false, error: "NOT_FOUND" }, 404);

    await upsertAdminRecordReadMark(recordType, id, now);
    invalidateRecordsListCache(recordType);
    invalidateSidebarCountsCache();

    return json({ ok: true, read_at: now });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
