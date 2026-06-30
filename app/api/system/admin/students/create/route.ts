import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireManager } from "@/lib/system/guard";
import { getSystemCourseIds } from "@/lib/system/courseCatalog.server";
import { COURSE_TYPE_ADVANCED } from "@/lib/system/courseTypes";
import { isStrongSystemPassword } from "@/lib/system/passwordPolicy";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { materializePinnedNotificationsForUser } from "@/lib/system/pinnedNotifications";
import { resolveExistingProfileId } from "@/lib/system/profileRefs";
import { dbBatch, dbFirst, dbRun } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const trimToUndefined = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lowered = trimmed.toLowerCase();
  if (["null", "undefined", "none", "nil", "n/a", "na", "-"].includes(lowered)) return undefined;
  return trimmed;
};

const Email = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z
    .string()
    .min(3)
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address")
);

const PHONE_REGEX = /^\+?[0-9]{6,20}$/;
const SOURCE_COMMERCIAL = "\u5546\u4e1a\u533a";
const SOURCE_OTHER = "\u5176\u4ed6\u6e20\u9053";
const STUDENT_STATUS_NORMAL = "\u666e\u901a\u5b66\u5458";

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
  initialPassword: z.preprocess((value) => (typeof value === "string" ? value : ""), z.string().min(1).max(64)),
  defaultOpenCourses: z.coerce.number().int().min(0).max(999).optional().default(0),
  leaderId: z.preprocess(trimToUndefined, z.string().trim().min(1).max(128).optional()),
  source: z.preprocess(trimToUndefined, z.string().max(40).optional())
});

function normalizeSource(input?: string | null) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "boss") return "boss";
  if (raw === SOURCE_COMMERCIAL || lower === "commercial") return SOURCE_COMMERCIAL;
  if (raw === SOURCE_OTHER || raw === "\u5176\u4ed6" || lower === "other") return SOURCE_OTHER;
  return null;
}

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function isMissingSchemaError(err: any) {
  const message = String(err?.message || "").toLowerCase();
  return message.includes("no such table") || message.includes("no such column");
}

async function cleanupProfileDependencies(userId: string) {
  const updateNullTargets: Array<{ table: string; column: string }> = [
    { table: "course_access", column: "reviewed_by" },
    { table: "course_group_access", column: "reviewed_by" },
    { table: "course_notes", column: "reviewed_by" },
    { table: "file_permissions", column: "granted_by" },
    { table: "file_access_requests", column: "reviewed_by" },
    { table: "trade_submissions", column: "reviewed_by" },
    { table: "trade_submissions", column: "archived_by" },
    { table: "classic_trades", column: "reviewed_by" },
    { table: "weekly_summaries", column: "reviewed_by" },
    { table: "ladder_authorizations", column: "reviewed_by" },
    { table: "ladder_snapshots", column: "created_by" },
    { table: "files", column: "uploaded_by" },
    { table: "student_documents", column: "reviewed_by" }
  ];

  for (const item of updateNullTargets) {
    try {
      await dbRun(`update ${item.table} set ${item.column} = null where ${item.column} = ?`, [userId]);
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }
  }

  const deleteTargets: Array<{ table: string; column: string }> = [
    { table: "coach_assignments", column: "assigned_user_id" },
    { table: "coach_assignments", column: "coach_id" },
    { table: "ladder_authorizations", column: "user_id" },
    { table: "student_documents", column: "student_id" },
    { table: "consult_messages", column: "from_user_id" },
    { table: "consult_messages", column: "to_user_id" },
    { table: "notifications", column: "to_user_id" },
    { table: "file_download_logs", column: "user_id" },
    { table: "file_access_requests", column: "user_id" },
    { table: "file_permissions", column: "grantee_profile_id" },
    { table: "course_access", column: "user_id" },
    { table: "course_group_access", column: "user_id" },
    { table: "course_notes", column: "user_id" },
    { table: "trade_submissions", column: "user_id" },
    { table: "classic_trades", column: "user_id" },
    { table: "weekly_summaries", column: "user_id" }
  ];

  for (const item of deleteTargets) {
    try {
      await dbRun(`delete from ${item.table} where ${item.column} = ?`, [userId]);
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }
  }
}

async function readBody(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    const data: Record<string, string> = {};
    form.forEach((value, key) => {
      data[key] = typeof value === "string" ? value : value.name;
    });
    return data;
  }

  const text = await req.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const params = new URLSearchParams(text);
    if (!Array.from(params.keys()).length) return null;
    const data: Record<string, string> = {};
    params.forEach((value, key) => {
      data[key] = value;
    });
    return data;
  }
}

function normalizeBody(input: Record<string, unknown> | null) {
  const data = (input || {}) as Record<string, unknown>;
  return {
    fullName: data.fullName ?? data.full_name ?? data.name ?? data.username,
    email: data.email ?? data.userEmail ?? data.mail,
    phone: data.phone ?? data.phone_number ?? data.mobile,
    initialPassword: data.initialPassword ?? data.initial_password ?? data.password ?? data.pass,
    defaultOpenCourses: data.defaultOpenCourses ?? data.default_open_courses ?? data.openCourses,
    leaderId: data.leaderId ?? data.leader_id ?? data.team_leader_id,
    source: data.source ?? data.origin ?? data.channel
  };
}

export async function POST(req: NextRequest) {
  let actorId = "";
  let actorRole: "leader" | "super_admin" | "assistant" = "leader";
  let actorLeaderId: string | null = null;
  try {
    const ctx = await requireManager();
    if (ctx.user.role === "coach") {
      return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);
    }
    actorId = ctx.user.id;
    actorRole =
      ctx.user.role === "super_admin"
        ? "super_admin"
        : ctx.user.role === "assistant"
          ? "assistant"
          : "leader";
    actorLeaderId = (await resolveExistingProfileId(ctx.user.leader_id)) ?? null;
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return noStoreJson({ ok: false, error: code }, status);
  }

  const parsed = Body.safeParse(normalizeBody(await readBody(req)));
  if (!parsed.success) {
    return noStoreJson({ ok: false, error: "INVALID_BODY", details: parsed.error.flatten() }, 400);
  }
  if (!isStrongSystemPassword(parsed.data.initialPassword)) {
    return noStoreJson({ ok: false, error: "WEAK_PASSWORD" }, 400);
  }

  const advancedCourseIds = await getSystemCourseIds(COURSE_TYPE_ADVANCED);
  const maxOpenCourses = advancedCourseIds.length;
  if (parsed.data.defaultOpenCourses > maxOpenCourses) {
    return noStoreJson(
      { ok: false, error: "INVALID_OPEN_COURSE_COUNT", maxOpenCourses },
      400
    );
  }

  const admin = dbAdmin();
  const now = new Date().toISOString();

  const fullName = parsed.data.fullName.trim();
  const email = parsed.data.email.trim().toLowerCase();
  const phoneRaw = typeof parsed.data.phone === "string" ? parsed.data.phone.trim() : "";
  const phone = phoneRaw.replace(/[\s-]/g, "");
  if (!phone) {
    return noStoreJson({ ok: false, error: "PHONE_REQUIRED" }, 400);
  }
  if (!PHONE_REGEX.test(phone)) {
    return noStoreJson({ ok: false, error: "INVALID_PHONE" }, 400);
  }

  const leaderIdRaw = typeof parsed.data.leaderId === "string" ? parsed.data.leaderId.trim() : "";
  let leaderId: string | null = null;
  if (actorRole === "leader") {
    leaderId = actorId;
  } else if (actorRole === "assistant") {
    if (!actorLeaderId) return noStoreJson({ ok: false, error: "MISSING_LEADER" }, 400);
    leaderId = actorLeaderId;
  } else {
    leaderId = leaderIdRaw ? leaderIdRaw : actorId;
    if (leaderIdRaw) {
      const leader = await dbFirst<{ id: string; role: string | null }>(
        "select id, role from profiles where id = ? limit 1",
        [leaderId]
      );
      if (!leader?.id || leader.role !== "leader") {
        return noStoreJson({ ok: false, error: "INVALID_LEADER" }, 400);
      }
    }
  }

  const existing = await dbFirst<{ id: string; status: string | null }>(
    "select id, status from profiles where lower(email) = lower(?) limit 1",
    [email]
  );
  if (existing?.id) {
    let canRecycle = String(existing.status || "").toLowerCase() === "deleted";

    if (!canRecycle) {
      try {
        const { data, error } = await admin.from("profiles").select("id").eq("id", existing.id).maybeSingle();
        if (!error && !data?.id) canRecycle = true;
      } catch {
        // ignore db metadata probe failures
      }
    }

    if (!canRecycle) {
      return noStoreJson({ ok: false, error: "EMAIL_EXISTS" }, 409);
    }

    try {
      await cleanupProfileDependencies(existing.id);
      await dbRun("delete from profiles where id = ?", [existing.id]);
    } catch (err: any) {
      return noStoreJson(
        { ok: false, error: "PROFILE_CLEANUP_FAILED", message: err?.message || String(err) },
        500
      );
    }

    try {
      const { error } = await admin.auth.admin.deleteUser(existing.id);
      if (error && !String(error.message || "").toLowerCase().includes("not found")) {
        return noStoreJson({ ok: false, error: error.message || "AUTH_DELETE_FAILED" }, 500);
      }
    } catch {
      // ignore auth cleanup failures, createUser below will report EMAIL_EXISTS if still occupied
    }
  }

  const createdAuth = await admin.auth.admin.createUser({
    email,
    password: parsed.data.initialPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName }
  });

  if (createdAuth.error || !createdAuth.data.user?.id) {
    const message = String(createdAuth.error?.message || "");
    const lowered = message.toLowerCase();
    if (lowered.includes("already") || lowered.includes("registered")) {
      return noStoreJson({ ok: false, error: "EMAIL_EXISTS" }, 409);
    }
    return noStoreJson({ ok: false, error: message || "AUTH_CREATE_FAILED" }, 500);
  }

  const createdUserId = createdAuth.data.user.id;
  const createdBy = actorRole === "assistant" ? actorId : null;

  const normalizedSource = normalizeSource(parsed.data.source ?? null);
  const forceZeroCourses = normalizedSource === SOURCE_COMMERCIAL || normalizedSource === SOURCE_OTHER;

  try {
    await dbRun(
      `insert into profiles
        (id, email, full_name, phone, role, leader_id, created_by, source, student_status, status, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createdUserId,
        email,
        fullName,
        phone || null,
        "student",
        leaderId,
        createdBy,
        normalizedSource,
        STUDENT_STATUS_NORMAL,
        "active",
        now,
        now
      ]
    );
  } catch (e: any) {
    await admin.auth.admin.deleteUser(createdUserId);
    return noStoreJson(
      { ok: false, error: "PROFILE_CREATE_FAILED", message: e?.message ?? String(e) },
      500
    );
  }

  const passwordInit = await admin.auth.admin.updateUserById(createdUserId, {
    password: parsed.data.initialPassword
  });
  if (passwordInit.error) {
    await admin.auth.admin.deleteUser(createdUserId);
    return noStoreJson(
      { ok: false, error: "PASSWORD_INIT_FAILED", message: passwordInit.error.message || "PASSWORD_INIT_FAILED" },
      500
    );
  }

  const defaultOpenCourses = forceZeroCourses ? 0 : Math.min(parsed.data.defaultOpenCourses, maxOpenCourses);

  if (defaultOpenCourses > 0) {
    const courseIds = advancedCourseIds.slice(0, defaultOpenCourses);
    const statements = courseIds.map((courseId) => ({
      sql:
        "insert into course_access (id, user_id, course_id, status, requested_at, reviewed_at, reviewed_by, updated_at) values (lower(hex(randomblob(16))), ?, ?, 'approved', ?, ?, ?, ?)",
      params: [createdUserId, courseId, now, now, actorId, now]
    }));
    await dbBatch(statements);
  }

  await materializePinnedNotificationsForUser(createdUserId).catch(() => null);

  return noStoreJson({ ok: true, id: createdUserId });
}


