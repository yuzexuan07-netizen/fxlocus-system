import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/system/guard";
import { ensureLearningStatus } from "@/lib/system/studentStatus";
import { dbAll, dbBatch, dbRun, sqlPlaceholders } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().optional(),
  fromCourseId: z.number().int().min(1).optional(),
  toCourseId: z.number().int().min(1).optional()
});

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  let adminUserId = "";
  try {
    const ctx = await requireAdmin();
    adminUserId = ctx.user.id;
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return noStoreJson({ ok: false, error: code }, status);
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ ok: false, error: "INVALID_BODY" }, 400);

  const now = new Date().toISOString();
  const where: string[] = ["status = ?"];
  const params: unknown[] = ["requested"];

  if (parsed.data.userId) {
    where.push("user_id = ?");
    params.push(parsed.data.userId);
  }
  if (parsed.data.fromCourseId) {
    where.push("course_id >= ?");
    params.push(parsed.data.fromCourseId);
  }
  if (parsed.data.toCourseId) {
    where.push("course_id <= ?");
    params.push(parsed.data.toCourseId);
  }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const targets = await dbAll<{ user_id: string; course_id: number }>(
    `select user_id, course_id from course_access ${whereSql} limit 2000`,
    params
  );

  await dbRun(
    `update course_access set status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = null, updated_at = ? ${whereSql}`,
    ["approved", now, adminUserId, now, ...params]
  );

  const userIds = Array.from(new Set((targets || []).map((t) => String(t.user_id || "")).filter(Boolean)));
  if (userIds.length) {
    await Promise.all(userIds.map((userId) => ensureLearningStatus(userId)));
  }

  const courseIds = Array.from(new Set((targets || []).map((t) => Number(t.course_id)).filter(Boolean)));
  const courses = courseIds.length
    ? await dbAll(
        `select id,title_zh,title_en from courses where id in (${sqlPlaceholders(courseIds.length)})`,
        courseIds
      )
    : [];
  const courseById = new Map((courses || []).map((c: any) => [c.id, c]));

  const notifications = (targets || []).map((t) => {
    const c = courseById.get(Number(t.course_id));
    const label = `#${t.course_id} ${c?.title_zh || c?.title_en || ""}`.trim();
    return {
      sql: "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
      params: [
        t.user_id,
        adminUserId,
        "课程申请已通过 / Course approved",
        `你的课程申请已通过：${label}\n\nYour course request has been approved: ${label}`,
        now
      ]
    };
  });

  if (notifications.length) {
    await dbBatch(notifications);
  }

  return noStoreJson({ ok: true });
}
