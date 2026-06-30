import { NextRequest, NextResponse } from "next/server";

import { requireSystemUser } from "@/lib/system/guard";
import { getPagination } from "@/lib/system/pagination";
import { dbAll, dbFirst } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { materializePinnedNotificationsForUser } from "@/lib/system/pinnedNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cacheJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireSystemUser();
    await materializePinnedNotificationsForUser(user.id).catch(() => null);
    const { page, pageSize, from } = getPagination(req, { defaultPageSize: 20, maxPageSize: 200 });
    const excludedTitle = "安全提醒";
    const excludedContent = "检测到新的登录设备。%";
    const [countRow, rows] = await Promise.all([
      dbFirst<{ count: number }>(
        [
          "select count(1) as count from notifications",
          "where to_user_id = ?",
          "and not (title = ? and content like ?)"
        ].join(" "),
        [user.id, excludedTitle, excludedContent]
      ),
      dbAll(
        [
          "select id, title, content, from_user_id, global_notice_id, read_at, pinned_at, created_at",
          "from notifications",
          "where to_user_id = ?",
          "and not (title = ? and content like ?)",
          "order by (pinned_at is not null) desc, pinned_at desc, created_at desc",
          "limit ? offset ?"
        ].join(" "),
        [user.id, excludedTitle, excludedContent, pageSize, from]
      )
    ]);

    return cacheJson({
      ok: true,
      items: rows || [],
      page,
      pageSize,
      total: Number(countRow?.count || (rows || []).length)
    });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return cacheJson({ ok: false, error: mapped.code }, mapped.status);
  }
}
