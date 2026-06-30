import { NextRequest, NextResponse } from "next/server";

import { dbAll, dbFirst } from "@/lib/d1";
import { hasSubmittedRequiredStudentDocuments } from "@/lib/system/courseAccessRules.server";
import { requireLearner } from "@/lib/system/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" }
  });
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireLearner();

    const [countRow, filesRows, permsRows, requests, documentsSubmitted] = await Promise.all([
      dbFirst<{ count: number }>("select count(1) as count from files where course_id is null and lesson_id is null"),
      dbAll(
        "select id, category, name, description, size_bytes, mime_type, created_at from files where course_id is null and lesson_id is null order by created_at desc"
      ),
      dbAll<{ file_id: string }>(
        "select file_id from file_permissions where grantee_profile_id = ?",
        [user.id]
      ),
      dbAll<{ file_id: string; status: string | null; rejection_reason: string | null; requested_at: string | null; reviewed_at: string | null }>(
        "select file_id, status, rejection_reason, requested_at, reviewed_at from file_access_requests where user_id = ?",
        [user.id]
      ),
      hasSubmittedRequiredStudentDocuments(user.id)
    ]);

    const allowed = new Set((permsRows || []).map((p: any) => p.file_id).filter(Boolean));
    const reqByFile = new Map((requests || []).map((r: any) => [r.file_id, r]));

    const files = (filesRows || []).map((f: any) => {
      const req = reqByFile.get(f.id);
      return {
        ...f,
        can_download: allowed.has(f.id),
        request_status: req?.status || "none",
        rejection_reason: req?.rejection_reason || null,
        requested_at: req?.requested_at || null,
        reviewed_at: req?.reviewed_at || null
      };
    });

    return json({
      ok: true,
      files,
      documentsSubmitted,
      total: Number(countRow?.count || files.length)
    });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
