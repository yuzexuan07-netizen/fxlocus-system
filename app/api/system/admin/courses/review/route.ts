import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/system/guard";
import { ensureLearningStatus } from "@/lib/system/studentStatus";
import { dbFirst, dbRun } from "@/lib/d1";
import { invalidateCourseRequestsCache, invalidateSidebarCountsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  accessId: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  rejectionReason: z.string().max(500).optional()
});

const BodyByUser = z.object({
  userId: z.string().min(1),
  courseId: z.coerce.number().int().min(1),
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(500).optional()
});

const REJECTION_REASONS = ["资料不完整", "不符合要求", "名额已满", "重复申请", "其他"] as const;
type RejectionReason = (typeof REJECTION_REASONS)[number];

function normalizeRejectionReason(input: unknown): RejectionReason {
  const value = String(input || "").trim();
  return (REJECTION_REASONS as readonly string[]).includes(value) ? (value as RejectionReason) : "其他";
}

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

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  const parsedByUser = BodyByUser.safeParse(raw);
  if (!parsed.success && !parsedByUser.success) return noStoreJson({ ok: false, error: "INVALID_BODY" }, 400);

  const now = new Date().toISOString();

  const notify = async (
    toUserId: string,
    courseId: number,
    status: "approved" | "rejected",
    reason?: string
  ) => {
    const c = await dbFirst<{ id: number; title_zh: string | null; title_en: string | null }>(
      "select id,title_zh,title_en from courses where id = ? limit 1",
      [courseId]
    );
    const label = `#${courseId} ${c?.title_zh || c?.title_en || ""}`.trim();
    const title =
      status === "approved"
        ? "课程申请已通过 / Course approved"
        : "课程申请被拒绝 / Course rejected";
    const content =
      status === "approved"
        ? `你的课程申请已通过：${label}\n\nYour course request has been approved: ${label}`
        : `你的课程申请被拒绝：${label}\n原因：${reason || "Rejected"}\n\nYour course request was rejected: ${label}\nReason: ${reason || "Rejected"}`;

    try {
      await dbRun(
        "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
        [toUserId, adminUserId, title, content, new Date().toISOString()]
      );
      return null;
    } catch (e: any) {
      return e;
    }
  };

  if (parsed.success) {
    const row = await dbFirst<{ user_id: string; course_id: number }>(
      "select user_id,course_id from course_access where id = ? limit 1",
      [parsed.data.accessId]
    );
    if (!row) return noStoreJson({ ok: false, error: "NOT_FOUND" }, 404);

    const payload: Record<string, unknown> = {
      reviewed_at: now,
      reviewed_by: adminUserId
    };

    if (parsed.data.action === "approve") {
      payload.status = "approved";
      payload.rejection_reason = null;
    } else {
      payload.status = "rejected";
      payload.rejection_reason = normalizeRejectionReason(parsed.data.rejectionReason);
    }

    try {
      await dbRun(
        "update course_access set status = ?, rejection_reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? where id = ?",
        [
          payload.status,
          payload.rejection_reason ?? null,
          now,
          adminUserId,
          now,
          parsed.data.accessId
        ]
      );
    } catch {
      return noStoreJson({ ok: false, error: "DB_ERROR" }, 500);
    }

    if (payload.status === "approved") {
      await ensureLearningStatus(String(row.user_id));
    }

    const nerr = await notify(
      String(row.user_id),
      Number(row.course_id),
      (payload.status as any) === "approved" ? "approved" : "rejected",
      String(payload.rejection_reason || "")
    );
    if (nerr) return noStoreJson({ ok: false, error: "NOTIFY_FAILED" }, 500);
    invalidateCourseRequestsCache();
    invalidateSidebarCountsCache();
    return noStoreJson({ ok: true });
  }

  if (!parsedByUser.success) {
    return noStoreJson({ ok: false, error: "INVALID_BODY" }, 400);
  }

  const status = parsedByUser.data.action === "approve" ? "approved" : "rejected";
  const reason = normalizeRejectionReason(parsedByUser.data.reason);

  const existing = await dbFirst<{ id: string }>(
    "select id from course_access where user_id = ? and course_id = ? limit 1",
    [parsedByUser.data.userId, parsedByUser.data.courseId]
  );

  if (!existing?.id) {
    try {
      await dbRun(
        [
          "insert into course_access",
          "(user_id, course_id, status, requested_at, reviewed_at, reviewed_by, rejection_reason, updated_at)",
          "values (?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [
          parsedByUser.data.userId,
          parsedByUser.data.courseId,
          status,
          now,
          now,
          adminUserId,
          status === "rejected" ? reason : null,
          now
        ]
      );
    } catch {
      return noStoreJson({ ok: false, error: "DB_ERROR" }, 500);
    }
    if (status === "approved") {
      await ensureLearningStatus(parsedByUser.data.userId);
    }
    const nerr = await notify(parsedByUser.data.userId, parsedByUser.data.courseId, status as any, reason);
    if (nerr) return noStoreJson({ ok: false, error: "NOTIFY_FAILED" }, 500);
    invalidateCourseRequestsCache();
    invalidateSidebarCountsCache();
    return noStoreJson({ ok: true });
  }

  try {
    await dbRun(
      "update course_access set status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = ?, updated_at = ? where id = ?",
      [status, now, adminUserId, status === "rejected" ? reason : null, now, existing.id]
    );
  } catch {
    return noStoreJson({ ok: false, error: "DB_ERROR" }, 500);
  }
  if (status === "approved") {
    await ensureLearningStatus(parsedByUser.data.userId);
  }

  const nerr = await notify(parsedByUser.data.userId, parsedByUser.data.courseId, status as any, reason);
  if (nerr) return noStoreJson({ ok: false, error: "NOTIFY_FAILED" }, 500);
  invalidateCourseRequestsCache();
  invalidateSidebarCountsCache();
  return noStoreJson({ ok: true });
}
