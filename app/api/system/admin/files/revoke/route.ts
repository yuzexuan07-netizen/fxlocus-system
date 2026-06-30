import { NextResponse } from "next/server";
import { z } from "zod";

import { dbAdmin } from "@/lib/system/dbAdmin";
import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    // files.id is a text primary key (legacy rows may be non-UUID)
    fileId: z.string().trim().min(1).max(128).optional(),
    file_id: z.string().trim().min(1).max(128).optional(),
    id: z.string().trim().min(1).max(128).optional(),
    userId: z.string().trim().min(1).max(128).optional(),
    user_id: z.string().trim().min(1).max(128).optional()
  })
  .transform((input) => ({
    fileId: String(input.fileId || input.file_id || input.id || "").trim(),
    userId: String(input.userId || input.user_id || "").trim()
  }));

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user: actor } = await requireAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success || !parsed.data.fileId || !parsed.data.userId) {
      return json({ ok: false, error: "INVALID_BODY" }, 400);
    }

    const admin = dbAdmin();
    const learnerRoles = ["student", "trader", "coach"];
    if (actor.role === "leader") {
      const { data: target } = await admin
        .from("profiles")
        .select("id,role")
        .eq("id", parsed.data.userId)
        .maybeSingle();
      if (!target?.id || !learnerRoles.includes(String(target.role || ""))) {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }
      const treeIds = await fetchLeaderTreeIds(actor.id);
      if (!treeIds.includes(target.id)) {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }
    }

    const now = new Date().toISOString();
    const del = await admin
      .from("file_permissions")
      .delete()
      .eq("file_id", parsed.data.fileId)
      .eq("grantee_profile_id", parsed.data.userId);
    if (del.error) return json({ ok: false, error: del.error.message }, 500);

    await admin
      .from("file_access_requests")
      .update({
        status: "rejected",
        reviewed_at: now,
        reviewed_by: actor.id,
        rejection_reason: "revoked"
      } as any)
      .eq("user_id", parsed.data.userId)
      .eq("file_id", parsed.data.fileId);

    const { data: f } = await admin
      .from("files")
      .select("id,name,category")
      .eq("id", parsed.data.fileId)
      .maybeSingle();
    const label = f ? `${f.category || ""} ${f.name || ""}`.trim() : parsed.data.fileId;

    await admin.from("notifications").insert({
      to_user_id: parsed.data.userId,
      from_user_id: actor.id,
      title: "File access revoked",
      content: `Your file access has been revoked: ${label}`
    } as any);

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
