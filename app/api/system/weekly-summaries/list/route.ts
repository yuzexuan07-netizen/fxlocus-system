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
      dbFirst<{ count: number }>("select count(1) as count from weekly_summaries where user_id = ?", [
        user.id
      ]),
      dbAll(
        [
          "select id, student_name, summary_text, review_note, reviewed_at, created_at,",
          "strategy_text,",
          "strategy_bucket, strategy_path, strategy_name, strategy_mime_type,",
          "curve_text,",
          "curve_bucket, curve_path, curve_name, curve_mime_type,",
          "stats_text,",
          "stats_bucket, stats_path, stats_name, stats_mime_type",
          "from weekly_summaries where user_id = ? order by created_at desc limit ? offset ?"
        ].join(" "),
        [user.id, pageSize, from]
      )
    ]);

    const items = (rows || []).map((row: any) => ({
      id: row.id,
      student_name: row.student_name,
      summary_text: row.summary_text,
      review_note: row.review_note,
      reviewed_at: row.reviewed_at,
      created_at: row.created_at,
      strategy_text: row.strategy_text,
      strategy_name: row.strategy_name,
      strategy_mime_type: row.strategy_mime_type,
      strategy_url:
        row.strategy_bucket && row.strategy_path
          ? buildStorageProxyUrl(row.strategy_bucket, row.strategy_path, {
              filename: row.strategy_name,
              contentType: row.strategy_mime_type
            })
          : null,
      curve_text: row.curve_text,
      curve_name: row.curve_name,
      curve_mime_type: row.curve_mime_type,
      curve_url:
        row.curve_bucket && row.curve_path
          ? buildStorageProxyUrl(row.curve_bucket, row.curve_path, {
              filename: row.curve_name,
              contentType: row.curve_mime_type
            })
          : null,
      stats_text: row.stats_text,
      stats_name: row.stats_name,
      stats_mime_type: row.stats_mime_type,
      stats_url:
        row.stats_bucket && row.stats_path
          ? buildStorageProxyUrl(row.stats_bucket, row.stats_path, {
              filename: row.stats_name,
              contentType: row.stats_mime_type
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
