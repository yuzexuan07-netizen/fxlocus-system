import { NextRequest, NextResponse } from "next/server";

import { dbAll, dbFirst, sqlPlaceholders } from "@/lib/d1";
import { requireLearner } from "@/lib/system/guard";
import { getPagination } from "@/lib/system/pagination";

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

    const countRow = await dbFirst<{ total: number }>(
      "select count(1) as total from trade_submissions where user_id = ? and type = ?",
      [user.id, "trade_strategy"]
    );

    const submissions = await dbAll(
      "select id,status,rejection_reason,review_note,created_at from trade_submissions where user_id = ? and type = ? order by created_at desc limit ? offset ?",
      [user.id, "trade_strategy", pageSize, from]
    );

    const ids = (submissions || []).map((s: any) => s.id);
    const files = ids.length
      ? await dbAll(
          `select id,submission_id,file_name,mime_type,size_bytes from trade_submission_files where submission_id in (${sqlPlaceholders(
            ids.length
          )})`,
          ids
        )
      : [];

    const filesBySubmission = new Map<string, any[]>();
    (files || []).forEach((f: any) => {
      const list = filesBySubmission.get(f.submission_id) || [];
      list.push(f);
      filesBySubmission.set(f.submission_id, list);
    });

    const items = (submissions || []).map((s: any) => {
      const list = filesBySubmission.get(s.id) || [];
      const nextFiles = list.map((f) => ({
        id: f.id,
        file_name: f.file_name,
        mime_type: f.mime_type || null,
        size_bytes: f.size_bytes || 0,
        url: f.id ? `/api/system/trade-submission-files/${f.id}/download?disposition=inline` : null
      }));
      return { ...s, files: nextFiles };
    });

    return json({ ok: true, items, page, pageSize, total: Number(countRow?.total || 0) });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
