import { NextResponse } from "next/server";
import { z } from "zod";
import { dbFirst, dbRun } from "@/lib/d1";

import { requireAdmin } from "@/lib/system/guard";
import { isStrongSystemPassword } from "@/lib/system/passwordPolicy";
import { dbAdmin } from "@/lib/system/dbAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Email = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z
    .string()
    .min(3)
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address")
);

const PHONE_REGEX = /^\+?[0-9]{6,20}$/;

const Body = z.object({
  fullName: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1).max(120)
  ),
  email: Email,
  phone: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1).max(40)
  ),
  password: z.preprocess((value) => (typeof value === "string" ? value : ""), z.string().min(1).max(64))
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAdmin();
    if (user.role !== "leader" && user.role !== "super_admin") {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return json({ ok: false, error: "INVALID_BODY", details: parsed.error.flatten() }, 400);
    }

    const email = parsed.data.email.trim().toLowerCase();
    const fullName = parsed.data.fullName.trim();
    const phoneRaw = parsed.data.phone.trim();
    const phone = phoneRaw.replace(/[\s-]/g, "");
    if (!phone || !PHONE_REGEX.test(phone)) {
      return json({ ok: false, error: "INVALID_PHONE" }, 400);
    }
    if (!isStrongSystemPassword(parsed.data.password)) {
      return json({ ok: false, error: "WEAK_PASSWORD" }, 400);
    }

    const admin = dbAdmin();

    const existing = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    if (existing.data?.id) {
      return json({ ok: false, error: "EMAIL_EXISTS" }, 409);
    }

    const created = await admin.auth.admin.createUser({
      email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });

    if (created.error || !created.data.user?.id) {
      const message = String(created.error?.message || "");
      const lowered = message.toLowerCase();
      if (lowered.includes("already") || lowered.includes("registered")) {
        return json({ ok: false, error: "EMAIL_EXISTS" }, 409);
      }
      return json({ ok: false, error: message || "AUTH_CREATE_FAILED" }, 500);
    }

    const userId = created.data.user.id;
    const now = new Date().toISOString();

    const ownerId = user.id;
    const upsert = await admin.from("profiles").upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        phone,
        role: "assistant",
        leader_id: ownerId,
        created_by: ownerId,
        status: "active",
        created_at: now,
        updated_at: now
      } as any,
      { onConflict: "id" }
    );

    if (upsert.error) {
      await admin.auth.admin.deleteUser(userId);
      return json({ ok: false, error: upsert.error.message }, 500);
    }

    const passwordInit = await admin.auth.admin.updateUserById(userId, {
      password: parsed.data.password
    });
    if (passwordInit.error) {
      await admin.auth.admin.deleteUser(userId);
      return json({ ok: false, error: passwordInit.error.message || "PASSWORD_INIT_FAILED" }, 500);
    }

    const { data: courses, error: coursesErr } = await admin
      .from("courses")
      .select("id")
      .is("deleted_at", null)
      .order("id", { ascending: true });
    if (coursesErr) {
      await admin.auth.admin.deleteUser(userId);
      return json({ ok: false, error: coursesErr.message }, 500);
    }

    const courseIds = ((courses || []) as Array<{ id: number | string }>)
      .map((course) => Number(course.id))
      .filter((courseId) => Number.isFinite(courseId));
    if (courseIds.length) {
      try {
        for (const courseId of courseIds) {
          const existingAccess = await dbFirst<{ id: string }>(
            "select id from course_access where user_id = ? and course_id = ? limit 1",
            [userId, courseId]
          );
          if (existingAccess?.id) {
            await dbRun(
              "update course_access set status = ?, requested_at = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = null, updated_at = ? where id = ?",
              ["approved", now, now, ownerId, now, existingAccess.id]
            );
            continue;
          }
          await dbRun(
            "insert into course_access (id, user_id, course_id, status, requested_at, reviewed_at, reviewed_by, updated_at) values (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)",
            [userId, courseId, "approved", now, now, ownerId, now]
          );
        }
      } catch (error: any) {
        await admin.auth.admin.deleteUser(userId);
        return json({ ok: false, error: String(error?.message || "COURSE_ACCESS_ASSIGN_FAILED") }, 500);
      }
    }

    return json({ ok: true, id: userId });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
