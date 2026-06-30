import { NextResponse } from "next/server";
import { z } from "zod";

import { dbBatch, dbRun } from "@/lib/d1";
import { getSystemCourseIds } from "@/lib/system/courseCatalog.server";
import {
  COURSE_TYPE_ADVANCED,
  COURSE_TYPE_COGNITIVE,
  COURSE_TYPE_MODEL,
  COURSE_TYPE_MOJING,
  normalizeCourseType
} from "@/lib/system/courseTypes";
import { requireManager } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { invalidateCourseRequestsCache, invalidateSidebarCountsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("advanced-set"),
    courseIds: z.array(z.coerce.number().int().min(1)).default([])
  }),
  z.object({
    mode: z.literal("course-type-set"),
    courseType: z.string().min(1).max(32),
    courseIds: z.array(z.coerce.number().int().min(1)).default([])
  }),
  z.object({
    mode: z.literal("close-all")
  }),
  z.object({
    mode: z.literal("group"),
    courseType: z.string().min(1).max(32),
    action: z.enum(["approve", "reject"])
  })
]);

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

async function assertCanManageStudent(actor: { id: string; role: string }, userId: string) {
  if (actor.role === "super_admin") return true;
  if (actor.role !== "leader") return false;
  const treeIds = await fetchLeaderTreeIds(actor.id);
  return treeIds.includes(userId);
}

async function buildIndividualCourseAccessStatements({
  userId,
  actorId,
  now,
  courseType,
  selectedCourseIds
}: {
  userId: string;
  actorId: string;
  now: string;
  courseType: typeof COURSE_TYPE_COGNITIVE | typeof COURSE_TYPE_ADVANCED;
  selectedCourseIds: number[];
}) {
  const allCourseIds = await getSystemCourseIds(courseType);
  const selected = new Set(selectedCourseIds.filter((courseId) => allCourseIds.includes(courseId)));

  return allCourseIds.map((courseId) => {
    const approved = selected.has(courseId);
    return {
      sql: [
        "insert into course_access",
        "(user_id, course_id, status, requested_at, reviewed_at, reviewed_by, rejection_reason, updated_at)",
        "values (?, ?, ?, ?, ?, ?, ?, ?)",
        "on conflict(user_id, course_id) do update set",
        "status = case when excluded.status = 'approved' and course_access.status = 'completed' then 'completed' else excluded.status end,",
        "reviewed_at = excluded.reviewed_at,",
        "reviewed_by = excluded.reviewed_by,",
        "rejection_reason = excluded.rejection_reason,",
        "updated_at = excluded.updated_at"
      ].join(" "),
      params: [
        userId,
        courseId,
        approved ? "approved" : "rejected",
        now,
        now,
        actorId,
        approved ? null : "\u5176\u4ed6",
        now
      ]
    };
  });
}

function buildGroupAccessStatement({
  userId,
  actorId,
  now,
  courseType,
  status
}: {
  userId: string;
  actorId: string;
  now: string;
  courseType: typeof COURSE_TYPE_MODEL | typeof COURSE_TYPE_MOJING;
  status: "approved" | "rejected";
}) {
  return {
    sql: [
      "insert into course_group_access",
      "(user_id, course_type, status, reviewed_at, reviewed_by, rejection_reason, updated_at)",
      "values (?, ?, ?, ?, ?, ?, ?)",
      "on conflict(user_id, course_type) do update set",
      "status = excluded.status,",
      "reviewed_at = excluded.reviewed_at,",
      "reviewed_by = excluded.reviewed_by,",
      "rejection_reason = excluded.rejection_reason,",
      "updated_at = excluded.updated_at"
    ].join(" "),
    params: [userId, courseType, status, now, actorId, status === "approved" ? null : "\u5176\u4ed6", now]
  };
}

export async function POST(req: Request, ctx: { params: { userId: string } }) {
  try {
    const { user: actor } = await requireManager();
    const userId = String(ctx?.params?.userId || "").trim();
    if (!userId) return json({ ok: false, error: "INVALID_USER_ID" }, 400);

    const canManage = await assertCanManageStudent(actor, userId);
    if (!canManage) return json({ ok: false, error: "FORBIDDEN" }, 403);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const now = new Date().toISOString();

    if (parsed.data.mode === "advanced-set") {
      const statements = await buildIndividualCourseAccessStatements({
        userId,
        actorId: actor.id,
        now,
        courseType: COURSE_TYPE_ADVANCED,
        selectedCourseIds: parsed.data.courseIds
      });
      if (statements.length) await dbBatch(statements);
    } else if (parsed.data.mode === "course-type-set") {
      const courseType = normalizeCourseType(parsed.data.courseType);
      if (courseType !== COURSE_TYPE_COGNITIVE && courseType !== COURSE_TYPE_ADVANCED) {
        return json({ ok: false, error: "INVALID_COURSE_TYPE" }, 400);
      }
      const statements = await buildIndividualCourseAccessStatements({
        userId,
        actorId: actor.id,
        now,
        courseType,
        selectedCourseIds: parsed.data.courseIds
      });
      if (statements.length) await dbBatch(statements);
    } else if (parsed.data.mode === "close-all") {
      const statements = [
        ...(await buildIndividualCourseAccessStatements({
          userId,
          actorId: actor.id,
          now,
          courseType: COURSE_TYPE_COGNITIVE,
          selectedCourseIds: []
        })),
        ...(await buildIndividualCourseAccessStatements({
          userId,
          actorId: actor.id,
          now,
          courseType: COURSE_TYPE_ADVANCED,
          selectedCourseIds: []
        })),
        buildGroupAccessStatement({
          userId,
          actorId: actor.id,
          now,
          courseType: COURSE_TYPE_MODEL,
          status: "rejected"
        }),
        buildGroupAccessStatement({
          userId,
          actorId: actor.id,
          now,
          courseType: COURSE_TYPE_MOJING,
          status: "rejected"
        })
      ];
      if (statements.length) await dbBatch(statements);
    } else {
      const courseType = normalizeCourseType(parsed.data.courseType);
      if (courseType !== COURSE_TYPE_MODEL && courseType !== COURSE_TYPE_MOJING) {
        return json({ ok: false, error: "INVALID_COURSE_TYPE" }, 400);
      }
      const status = parsed.data.action === "approve" ? "approved" : "rejected";
      const statement = buildGroupAccessStatement({ userId, actorId: actor.id, now, courseType, status });
      await dbRun(statement.sql, statement.params);
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
