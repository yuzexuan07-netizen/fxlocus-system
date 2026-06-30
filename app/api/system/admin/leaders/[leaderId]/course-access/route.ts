import { NextResponse } from "next/server";
import { z } from "zod";

import { dbBatch, dbFirst, dbRun } from "@/lib/d1";
import { invalidateCourseRequestsCache, invalidateSidebarCountsCache } from "@/lib/system/cacheInvalidation";
import { getSystemCourseIds } from "@/lib/system/courseCatalog.server";
import {
  COURSE_TYPE_ADVANCED,
  COURSE_TYPE_COGNITIVE,
  COURSE_TYPE_MODEL,
  COURSE_TYPE_MOJING,
  normalizeCourseType
} from "@/lib/system/courseTypes";
import { requireSuperAdmin } from "@/lib/system/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("mode", [
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

async function assertLeaderExists(leaderId: string) {
  const row = await dbFirst<{ id: string }>(
    "select id from profiles where id = ? and role = 'leader' limit 1",
    [leaderId]
  );
  return Boolean(row?.id);
}

async function buildIndividualCourseAccessStatements({
  leaderId,
  actorId,
  now,
  courseType,
  selectedCourseIds
}: {
  leaderId: string;
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
        leaderId,
        courseId,
        approved ? "approved" : "rejected",
        now,
        now,
        actorId,
        approved ? null : "其他",
        now
      ]
    };
  });
}

function buildGroupAccessStatement({
  leaderId,
  actorId,
  now,
  courseType,
  status
}: {
  leaderId: string;
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
    params: [leaderId, courseType, status, now, actorId, status === "approved" ? null : "其他", now]
  };
}

export async function POST(req: Request, ctx: { params: { leaderId: string } }) {
  try {
    const { user: actor } = await requireSuperAdmin();
    const leaderId = String(ctx?.params?.leaderId || "").trim();
    if (!leaderId) return json({ ok: false, error: "INVALID_LEADER_ID" }, 400);

    const exists = await assertLeaderExists(leaderId);
    if (!exists) return json({ ok: false, error: "NOT_FOUND" }, 404);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const now = new Date().toISOString();

    if (parsed.data.mode === "course-type-set") {
      const courseType = normalizeCourseType(parsed.data.courseType);
      if (courseType !== COURSE_TYPE_COGNITIVE && courseType !== COURSE_TYPE_ADVANCED) {
        return json({ ok: false, error: "INVALID_COURSE_TYPE" }, 400);
      }
      const statements = await buildIndividualCourseAccessStatements({
        leaderId,
        actorId: actor.id,
        now,
        courseType,
        selectedCourseIds: parsed.data.courseIds
      });
      if (statements.length) await dbBatch(statements);
    } else if (parsed.data.mode === "close-all") {
      const statements = [
        ...(await buildIndividualCourseAccessStatements({
          leaderId,
          actorId: actor.id,
          now,
          courseType: COURSE_TYPE_COGNITIVE,
          selectedCourseIds: []
        })),
        ...(await buildIndividualCourseAccessStatements({
          leaderId,
          actorId: actor.id,
          now,
          courseType: COURSE_TYPE_ADVANCED,
          selectedCourseIds: []
        })),
        buildGroupAccessStatement({
          leaderId,
          actorId: actor.id,
          now,
          courseType: COURSE_TYPE_MODEL,
          status: "rejected"
        }),
        buildGroupAccessStatement({
          leaderId,
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
      const statement = buildGroupAccessStatement({ leaderId, actorId: actor.id, now, courseType, status });
      await dbRun(statement.sql, statement.params);
    }

    invalidateCourseRequestsCache();
    invalidateSidebarCountsCache();

    return json({ ok: true });
  } catch (error: any) {
    const code = String(error?.code || "INTERNAL_ERROR");
    const status = code === "FORBIDDEN" || code === "FROZEN" ? 403 : code === "UNAUTHORIZED" ? 401 : 500;
    return json({ ok: false, error: code }, status);
  }
}
