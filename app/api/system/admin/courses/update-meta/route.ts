import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdmin } from "@/lib/system/guard";
import { normalizeCourseType } from "@/lib/system/courseTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  courseId: z.coerce.number().int().min(1),
  courseType: z.string().max(32).optional(),
  sortOrder: z.coerce.number().int().min(1).max(10000).optional(),
  title_zh: z.string().max(200).optional(),
  title_en: z.string().max(200).optional(),
  summary_zh: z.string().max(800).optional(),
  summary_en: z.string().max(800).optional(),
  published: z.boolean().optional(),
  deleted: z.boolean().optional()
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { db } = await requireSuperAdmin();
    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { id: parsed.data.courseId, updated_at: now };
    patch.course_type = normalizeCourseType(parsed.data.courseType);
    patch.sort_order = parsed.data.sortOrder ?? parsed.data.courseId;

    if (typeof parsed.data.title_zh === "string") patch.title_zh = parsed.data.title_zh;
    if (typeof parsed.data.title_en === "string") patch.title_en = parsed.data.title_en;
    if (typeof parsed.data.summary_zh === "string") patch.summary_zh = parsed.data.summary_zh;
    if (typeof parsed.data.summary_en === "string") patch.summary_en = parsed.data.summary_en;
    if (typeof parsed.data.published === "boolean") patch.published = parsed.data.published;
    if (typeof parsed.data.deleted === "boolean") {
      patch.deleted_at = parsed.data.deleted ? now : null;
      if (parsed.data.deleted) patch.published = false;
    }

    const up = await db
      .from("courses")
      .upsert(patch as any, { onConflict: "id" })
      .select("*")
      .single();

    if (up.error) return json({ ok: false, error: up.error.message }, 500);
    return json({ ok: true, course: up.data });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}

