import { NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { dbFirst, dbRun } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { invalidateCourseNotesCache, invalidateSidebarCountsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  noteId: z.preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    z.string().trim().min(1).max(128)
  ),
  reviewNote: z.string().max(2000).optional().nullable()
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireManager();
    if (user.role === "coach") return json({ ok: false, error: "FORBIDDEN" }, 403);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const note = await dbFirst<{
      id: string;
      user_id: string | null;
      course_id: number | null;
      submitted_at: string | null;
      reviewed_at: string | null;
    }>(
      "select id, user_id, course_id, submitted_at, reviewed_at from course_notes where id = ? limit 1",
      [parsed.data.noteId]
    );

    if (!note?.id || !note.user_id) return json({ ok: false, error: "NOT_FOUND" }, 404);
    if (!note.submitted_at) return json({ ok: false, error: "NOT_SUBMITTED" }, 400);

    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      if (!treeIds.includes(note.user_id)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    } else if (user.role === "assistant") {
      const createdIds = await fetchAssistantCreatedUserIds(user.id);
      if (!createdIds.includes(note.user_id)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const now = new Date().toISOString();
    const reviewNote = String(parsed.data.reviewNote || "").trim();

    await dbRun(
      "update course_notes set reviewed_at = ?, reviewed_by = ?, review_note = ?, updated_at = ? where id = ?",
      [now, user.id, reviewNote || null, now, note.id]
    );

    const courseId = Number(note.course_id || 0);
    const title = reviewNote ? "Course summary replied" : "Course summary reviewed";
    const content = reviewNote
      ? `Lesson ${courseId} summary note: ${reviewNote}`
      : `Lesson ${courseId} summary reviewed.`;

    await dbRun(
      "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
      [note.user_id, user.id, title, content, now]
    );

    invalidateCourseNotesCache();
    invalidateSidebarCountsCache();

    return json({ ok: true });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
