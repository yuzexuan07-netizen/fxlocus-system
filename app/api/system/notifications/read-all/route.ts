import { NextResponse } from "next/server";

import { requireSystemUser } from "@/lib/system/guard";
import { dbRun } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { invalidateSidebarCountsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  try {
    const { user } = await requireSystemUser();
    const now = new Date().toISOString();
    const res = await dbRun(
      "update notifications set read_at = ? where to_user_id = ? and read_at is null",
      [now, user.id]
    );
    const affected = Number((res as any)?.meta?.changes ?? 0);
    invalidateSidebarCountsCache();
    return json({ ok: true, affected });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
