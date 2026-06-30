import { NextResponse } from "next/server";

import { requireSystemUser } from "@/lib/system/guard";
import { dbFirst } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user } = await requireSystemUser();
    const body = await req.json().catch(() => null);
    const fileId = String(body?.fileId || "");

    if (!fileId) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const f = await dbFirst<{
      id: string;
      name: string | null;
      mime_type: string | null;
      storage_bucket: string | null;
      storage_path: string | null;
    }>(
      "select id, name, mime_type, storage_bucket, storage_path from files where id = ? limit 1",
      [fileId]
    );
    if (!f?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);

    let allowed = user.role === "super_admin";
    if (!allowed) {
      const seg = String(f.storage_path || "").split("/")[0];
      if (seg && seg === user.id) {
        allowed = true;
      } else {
        const perm = await dbFirst<{ file_id: string }>(
          "select file_id from file_permissions where file_id = ? and grantee_profile_id = ? limit 1",
          [fileId, user.id]
        );
        allowed = Boolean(perm?.file_id);
      }
    }

    if (!allowed) return json({ ok: false, error: "FORBIDDEN" }, 403);

    const bucket = f.storage_bucket;
    const path = f.storage_path;
    if (!bucket || !path) return json({ ok: false, error: "MISSING_STORAGE" }, 500);

    const encodedId = encodeURIComponent(fileId);
    const downloadUrl = `/api/system/files/${encodedId}/download?disposition=attachment`;
    return json({ ok: true, url: downloadUrl });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
