import { NextRequest, NextResponse } from "next/server";

import { requireLearner } from "@/lib/system/guard";
import { getPagination } from "@/lib/system/pagination";
import { dbAll, dbFirst } from "@/lib/d1";
import { buildStorageProxyUrl } from "@/lib/storage/objectUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireLearner();
    const { page, pageSize, from } = getPagination(req, { defaultPageSize: 20, maxPageSize: 200 });

    const [countRow, rows] = await Promise.all([
      dbFirst<{ count: number }>("select count(1) as count from classic_trades where user_id = ?", [
        user.id
      ]),
      dbAll(
        [
          "select id,reason,review_note,reviewed_at,created_at,",
          "image_bucket,image_path,image_name,image_mime_type",
          "from classic_trades where user_id = ? order by created_at desc limit ? offset ?"
        ].join(" "),
        [user.id, pageSize, from]
      )
    ]);

    const items = (rows || []).map((row: any) => ({
      id: row.id,
      reason: row.reason,
      review_note: row.review_note,
      reviewed_at: row.reviewed_at,
      created_at: row.created_at,
      image_name: row.image_name,
      image_mime_type: row.image_mime_type,
      image_url:
        row.image_bucket && row.image_path
          ? buildStorageProxyUrl(row.image_bucket, row.image_path, {
              filename: row.image_name,
              contentType: row.image_mime_type
            })
          : null
    }));

    return json({ ok: true, items, page, pageSize, total: Number(countRow?.count || items.length) });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
