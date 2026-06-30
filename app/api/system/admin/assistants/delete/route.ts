import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().trim().min(1).max(128)
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const admin = dbAdmin();
    const { data: target, error: targetErr } = await admin
      .from("profiles")
      .select("id,role,leader_id")
      .eq("id", parsed.data.userId)
      .maybeSingle();
    if (targetErr) return json({ ok: false, error: targetErr.message }, 500);
    if (!target?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
    if (target.role !== "assistant") return json({ ok: false, error: "INVALID_TARGET" }, 400);
    if (user.role === "leader" && target.leader_id !== user.id) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const cleanup = async (table: string, column: string) => {
      const { error } = await admin.from(table).update({ [column]: null } as any).eq(column, target.id);
      if (error) {
        const msg = String(error.message || "").toLowerCase();
        if (!msg.includes("does not exist") && !msg.includes("relation")) {
          throw new Error(error.message);
        }
      }
    };

    await Promise.all([
      cleanup("course_access", "reviewed_by"),
      cleanup("course_notes", "reviewed_by"),
      cleanup("files", "uploaded_by"),
      cleanup("file_permissions", "granted_by"),
      cleanup("file_access_requests", "reviewed_by"),
      cleanup("trade_submissions", "reviewed_by"),
      cleanup("trade_submissions", "archived_by"),
      cleanup("classic_trades", "reviewed_by"),
      cleanup("weekly_summaries", "reviewed_by"),
      cleanup("ladder_authorizations", "reviewed_by"),
      cleanup("ladder_snapshots", "created_by")
    ]);

    const del = await admin.auth.admin.deleteUser(target.id);
    if (del.error) return json({ ok: false, error: del.error.message }, 500);
    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
