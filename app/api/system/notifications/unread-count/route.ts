import { NextResponse } from "next/server";

import { requireSystemUser } from "@/lib/system/guard";
import { dbFirst } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { materializePinnedNotificationsForUser } from "@/lib/system/pinnedNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function GET() {
  try {
    const { user } = await requireSystemUser();
    await materializePinnedNotificationsForUser(user.id).catch(() => null);
    const [allUnreadRow, deviceLoginRow] = await Promise.all([
      dbFirst<{ count: number }>(
        "select count(1) as count from notifications where to_user_id = ? and read_at is null",
        [user.id]
      ),
      dbFirst<{ count: number }>(
        [
          "select count(1) as count from notifications",
          "where to_user_id = ? and read_at is null",
          "and title = ? and content like ?"
        ].join(" "),
        [user.id, "安全提醒", "检测到新的登录设备。%"]
      )
    ]);
    const row = await dbFirst<{ count: number }>(
      [
        "select count(1) as count from notifications",
        "where to_user_id = ? and read_at is null",
        "and not (title = ? and content like ?)"
      ].join(" "),
      [user.id, "安全提醒", "检测到新的登录设备。%"]
    );
    const legacyCount = Number(row?.count || 0);
    const normalizedCount = Math.max(0, Number(allUnreadRow?.count || 0) - Number(deviceLoginRow?.count || 0));
    return json({ ok: true, count: Math.min(legacyCount, normalizedCount) });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
