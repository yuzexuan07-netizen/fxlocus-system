import { NextRequest, NextResponse } from "next/server";

import { requireSystemUser } from "@/lib/system/guard";
import { dbFirst, dbRun } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { invalidateSidebarCountsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  if (!id) return noStoreJson({ ok: false, error: "INVALID_ID" }, 400);

  try {
    const { user } = await requireSystemUser();
    const row = await dbFirst<{ id: string; to_user_id: string }>(
      "select id, to_user_id from notifications where id = ? limit 1",
      [id]
    );
    if (!row?.id) return noStoreJson({ ok: false, error: "NOT_FOUND" }, 404);
    if (row.to_user_id !== user.id) return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);

    const now = new Date().toISOString();
    const res = await dbRun("update notifications set read_at = ? where id = ?", [now, id]);
    const affected = Number((res as any)?.meta?.changes ?? 0);
    invalidateSidebarCountsCache();
    return noStoreJson({ ok: true, affected });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return noStoreJson({ ok: false, error: mapped.code }, mapped.status);
  }
}
