import { NextResponse } from "next/server";
import { z } from "zod";

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
    keyword: z.string().trim().min(1).max(200)
  })
  .transform((input) => ({
    fileId: String(input.fileId || input.file_id || input.id || "").trim(),
    keyword: input.keyword
  }));

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user: adminUser, db } = await requireAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success || !parsed.data.fileId) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const fileId = parsed.data.fileId;
    const keyword = parsed.data.keyword.trim();
    const isLeader = adminUser.role === "leader";

    const learnerRoles = ["student", "trader", "coach"];
    let profileQuery = db
      .from("profiles")
      .select("id,role,full_name,email,leader_id")
      .in("role", learnerRoles);

    if (isLeader) {
      const treeIds = await fetchLeaderTreeIds(adminUser.id);
      if (!treeIds.length) return json({ ok: false, error: "NO_MATCH" }, 404);
      profileQuery = profileQuery.in("id", treeIds);
    }

    const { data: matches, error: profileErr } = keyword.includes("@")
      ? await profileQuery.eq("email", keyword.toLowerCase()).limit(5)
      : await profileQuery.ilike("full_name", `%${keyword}%`).limit(5);

    if (profileErr) return json({ ok: false, error: profileErr.message }, 500);
    if (!matches?.length) return json({ ok: false, error: "NO_MATCH" }, 404);
    if (matches.length > 1) return json({ ok: false, error: "MULTIPLE_MATCH" }, 400);

    const profile = matches[0];
    if (!learnerRoles.includes(profile.role)) return json({ ok: false, error: "NOT_A_STUDENT" }, 400);

    const ins = await db.from("file_permissions").upsert(
      {
        file_id: fileId,
        grantee_profile_id: profile.id,
        granted_by: adminUser.id
      } as any,
      { onConflict: "file_id,grantee_profile_id", ignoreDuplicates: true }
    );

    if (ins.error) return json({ ok: false, error: ins.error.message }, 500);

    const { data: f } = await db.from("files").select("id,name,category").eq("id", fileId).maybeSingle();
    const label = f ? `${f.category || ""} ${f.name || ""}`.trim() : fileId;

    const note = await db.from("notifications").insert({
      to_user_id: profile.id,
      from_user_id: adminUser.id,
      title: "文件权限已开通 / File access granted",
      content: `你已获得文件下载权限：${label}\n\nYou have been granted access to download: ${label}`
    } as any);

    if (note.error) return json({ ok: false, error: "NOTIFY_FAILED" }, 500);
    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
