import { NextResponse } from "next/server";

import { requireLearner } from "@/lib/system/guard";
import { buildStudentSubmitContent, notifyLeadersAndAdmins } from "@/lib/system/notify";
import { dbFirst, dbRun } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user } = await requireLearner();
    const body = await req.json().catch(() => null);

    const fileId = String(body?.fileId || "");
    if (!fileId) return json({ ok: false, error: "INVALID_FILE" }, 400);

    const now = new Date().toISOString();

    const existing = await dbFirst<{ status: string | null }>(
      "select status from file_access_requests where user_id = ? and file_id = ? limit 1",
      [user.id, fileId]
    );

    if (!existing) {
      await dbRun(
        [
          "insert into file_access_requests (user_id, file_id, status, requested_at, reviewed_at, reviewed_by, rejection_reason)",
          "values (?, ?, ?, ?, null, null, null)"
        ].join(" "),
        [user.id, fileId, "requested", now]
      );
      await notifyLeadersAndAdmins(user, {
        title: "\u6587\u4ef6\u6743\u9650\u7533\u8bf7 / File access request",
        content: buildStudentSubmitContent(
          user,
          `\u7533\u8bf7\u4e86\u6587\u4ef6\u6743\u9650\uff08${fileId}\uff09\u3002`,
          `requested file access (${fileId}).`
        )
      });
      return json({ ok: true });
    }

    if (existing.status === "rejected") {
      await dbRun(
        [
          "update file_access_requests set status = ?, requested_at = ?, reviewed_at = null, reviewed_by = null, rejection_reason = null",
          "where user_id = ? and file_id = ?"
        ].join(" "),
        ["requested", now, user.id, fileId]
      );
      await notifyLeadersAndAdmins(user, {
        title: "\u6587\u4ef6\u6743\u9650\u7533\u8bf7 / File access request",
        content: buildStudentSubmitContent(
          user,
          `\u91cd\u65b0\u7533\u8bf7\u4e86\u6587\u4ef6\u6743\u9650\uff08${fileId}\uff09\u3002`,
          `re-requested file access (${fileId}).`
        )
      });
    }

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
