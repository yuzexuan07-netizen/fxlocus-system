import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSystemUser } from "@/lib/system/guard";
import { dbFirst, dbRun } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { isAdminRole } from "@/lib/system/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  pinned: z.boolean()
});

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const id = ctx.params.id;
  if (!id) return noStoreJson({ ok: false, error: "INVALID_ID" }, 400);

  try {
    const { user } = await requireSystemUser();
    if (!isAdminRole(user.role)) return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);

    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return noStoreJson({ ok: false, error: "INVALID_BODY" }, 400);

    const row = await dbFirst<{
      id: string;
      to_user_id: string;
      from_user_id: string | null;
      global_notice_id: string | null;
    }>(
      "select id, to_user_id, from_user_id, global_notice_id from notifications where id = ? limit 1",
      [id]
    );
    if (!row?.id) return noStoreJson({ ok: false, error: "NOT_FOUND" }, 404);
    if (row.to_user_id !== user.id) return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);
    if (!row.global_notice_id || row.from_user_id !== user.id) {
      return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);
    }

    if (parsed.data.pinned) {
      const now = new Date().toISOString();
      await dbRun(
        "update notifications set pinned_at = ? where global_notice_id = ? and from_user_id = ?",
        [now, row.global_notice_id, user.id]
      );
      return noStoreJson({ ok: true, pinned_at: now });
    }

    await dbRun(
      "update notifications set pinned_at = null where global_notice_id = ? and from_user_id = ?",
      [row.global_notice_id, user.id]
    );
    return noStoreJson({ ok: true, pinned_at: null });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return noStoreJson({ ok: false, error: mapped.code }, mapped.status);
  }
}
