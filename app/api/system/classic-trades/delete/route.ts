import { NextResponse } from "next/server";
import { z } from "zod";

import { requireLearner } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { removeStoredObjects } from "@/lib/storage/storage";
import { dbFirst, dbRun } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  entryId: z.string().trim().min(1).max(128)
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user } = await requireLearner();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const admin = dbAdmin();
    const row = await dbFirst<{
      id: string;
      user_id: string;
      image_bucket: string | null;
      image_path: string | null;
    }>(
      "select id,user_id,image_bucket,image_path from classic_trades where id = ? limit 1",
      [parsed.data.entryId]
    );
    if (!row?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
    if (row.user_id !== user.id) return json({ ok: false, error: "FORBIDDEN" }, 403);

    try {
      await dbRun("delete from classic_trades where id = ?", [row.id]);
    } catch {
      return json({ ok: false, error: "DB_ERROR" }, 500);
    }

    if (row.image_bucket && row.image_path) {
      await removeStoredObjects(admin, [{ bucket: row.image_bucket, path: row.image_path }]);
    }

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
