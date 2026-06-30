import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { removeStoredObjects } from "@/lib/storage/storage";
import { dbAll, dbFirst, dbRun } from "@/lib/d1";
import { invalidateTradeSubmissionsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  submissionId: z.string().trim().min(1).max(128)
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAdmin();
    const body = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const submission = await dbFirst<{ id: string; user_id: string; archived_at: string | null }>(
      "select id,user_id,archived_at from trade_submissions where id = ? limit 1",
      [parsed.data.submissionId]
    );
    if (!submission?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
    if (!submission.archived_at) return json({ ok: false, error: "NOT_ARCHIVED" }, 400);

    if (user.role === "leader") {
      const scopeIds = await fetchLeaderTreeIds(user.id);
      if (!scopeIds.includes(submission.user_id)) {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }
    }

    const admin = dbAdmin();
    const files = await dbAll<{ storage_bucket: string | null; storage_path: string | null }>(
      "select storage_bucket,storage_path from trade_submission_files where submission_id = ?",
      [parsed.data.submissionId]
    );
    const stored = (files || [])
      .filter((row) => row?.storage_bucket && row?.storage_path)
      .map((row) => ({ bucket: String(row.storage_bucket), path: String(row.storage_path) }));
    if (stored.length) {
      await removeStoredObjects(admin, stored);
    }

    await dbRun("delete from trade_submission_files where submission_id = ?", [parsed.data.submissionId]);
    await dbRun("delete from trade_submissions where id = ?", [parsed.data.submissionId]);
    invalidateTradeSubmissionsCache();

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
