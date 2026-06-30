import { NextResponse } from "next/server";
import { z } from "zod";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchCoachAssignedUserSet } from "@/lib/system/coachAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { ensureLearningStatus } from "@/lib/system/studentStatus";
import { dbAll, dbBatch, dbRun, sqlPlaceholders } from "@/lib/d1";
import { invalidateCourseRequestsCache, invalidateSidebarCountsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  items: z
    .array(
      z.object({
        userId: z.string().trim().min(1).max(128),
        courseId: z.coerce.number().int().min(1)
      })
    )
    .min(1),
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(500).optional()
});

const REJECTION_REASONS = [
  "\u8d44\u6599\u4e0d\u5b8c\u6574",
  "\u4e0d\u7b26\u5408\u8981\u6c42",
  "\u540d\u989d\u5df2\u6ee1",
  "\u91cd\u590d\u7533\u8bf7",
  "\u5176\u4ed6"
] as const;
type RejectionReason = (typeof REJECTION_REASONS)[number];

function normalizeRejectionReason(input: unknown): RejectionReason {
  const value = String(input || "").trim();
  return (REJECTION_REASONS as readonly string[]).includes(value)
    ? (value as RejectionReason)
    : "\u5176\u4ed6";
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user: adminUser } = await requireManager();
    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    if (adminUser.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(adminUser.id);
      const treeSet = new Set(treeIds);
      const invalid = parsed.data.items.find((it) => !treeSet.has(it.userId));
      if (invalid) return json({ ok: false, error: "FORBIDDEN" }, 403);
    } else if (adminUser.role === "coach") {
      const assignedSet = await fetchCoachAssignedUserSet(adminUser.id);
      const invalid = parsed.data.items.find((it) => !assignedSet.has(it.userId));
      if (invalid) return json({ ok: false, error: "FORBIDDEN" }, 403);
    } else if (adminUser.role === "assistant") {
      const createdIds = await fetchAssistantCreatedUserIds(adminUser.id);
      const createdSet = new Set(createdIds);
      const invalid = parsed.data.items.find((it) => !createdSet.has(it.userId));
      if (invalid) return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const now = new Date().toISOString();
    const status = parsed.data.action === "approve" ? "approved" : "rejected";
    const rejectionReason = status === "rejected" ? normalizeRejectionReason(parsed.data.reason) : null;

    for (const it of parsed.data.items) {
      const res = await dbRun(
        "update course_access set status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = ?, updated_at = ? where user_id = ? and course_id = ?",
        [status, now, adminUser.id, rejectionReason, now, it.userId, it.courseId]
      );
      const changes = (res as any)?.meta?.changes ?? 0;
      if (!changes) {
        await dbRun(
          [
            "insert into course_access",
            "(user_id, course_id, status, requested_at, reviewed_at, reviewed_by, rejection_reason, updated_at)",
            "values (?, ?, ?, ?, ?, ?, ?, ?)"
          ].join(" "),
          [it.userId, it.courseId, status, now, now, adminUser.id, rejectionReason, now]
        );
      }
    }

    if (status === "approved") {
      const userIds = Array.from(new Set(parsed.data.items.map((it) => it.userId)));
      await Promise.all(userIds.map((userId) => ensureLearningStatus(userId)));
    }

    const courseIds = Array.from(new Set(parsed.data.items.map((it) => it.courseId)));
    const courses = courseIds.length
      ? await dbAll(
          `select id,title_zh,title_en from courses where id in (${sqlPlaceholders(courseIds.length)})`,
          courseIds
        )
      : [];
    const courseById = new Map((courses || []).map((c: any) => [c.id, c]));

    const notifications = parsed.data.items.map((it) => {
      const c = courseById.get(it.courseId);
      const label = `#${it.courseId} ${c?.title_zh || c?.title_en || ""}`.trim();
      const title = status === "approved" ? "Course approved" : "Course rejected";
      const content =
        status === "approved"
          ? `Your course request has been approved: ${label}`
          : `Your course request was rejected: ${label}\nReason: ${rejectionReason}`;

      return {
        sql: "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
        params: [it.userId, adminUser.id, title, content, now]
      };
    });

    if (notifications.length) {
      await dbBatch(notifications);
    }

    invalidateCourseRequestsCache();
    invalidateSidebarCountsCache();

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}

