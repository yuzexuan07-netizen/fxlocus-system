import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireLearner } from "@/lib/system/guard";
import { ensureCourseProgressAccess } from "@/lib/system/courseAuthorization.server";
import { dbRun } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  lastVideoSec: z.number().int().min(0).optional(),
  progress: z.number().int().min(0).max(100).nullable().optional()
});

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: { params: { courseId: string } }) {
  let userId = "";
  try {
    const res = await requireLearner();
    userId = res.user.id;
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return noStoreJson({ ok: false, error: code }, status);
  }

  const courseId = Number(ctx.params.courseId);
  if (!Number.isInteger(courseId) || courseId < 1 || courseId > 5000) {
    return noStoreJson({ ok: false, error: "INVALID_COURSE" }, 400);
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ ok: false, error: "INVALID_BODY" }, 400);

  const now = new Date().toISOString();

  const { state, access } = await ensureCourseProgressAccess(userId, courseId);
  if (!state.course) return noStoreJson({ ok: false, error: "INVALID_COURSE" }, 400);
  if (!access) return noStoreJson({ ok: false, error: "NO_ACCESS" }, 403);
  if (access.status !== "approved" && access.status !== "completed") {
    return noStoreJson({ ok: false, error: "NOT_APPROVED" }, 403);
  }

  const nextLast = typeof parsed.data.lastVideoSec === "number" ? parsed.data.lastVideoSec : access.last_video_sec;
  const nextProgress =
    typeof parsed.data.progress === "number"
      ? parsed.data.progress
      : access.progress;

  await dbRun(
    "update course_access set last_video_sec = ?, progress = ?, updated_at = ? where id = ?",
    [nextLast ?? null, nextProgress ?? null, now, access.id]
  );
  return noStoreJson({ ok: true });
}
