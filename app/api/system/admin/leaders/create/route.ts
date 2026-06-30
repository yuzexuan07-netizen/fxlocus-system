import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdmin } from "@/lib/system/guard";
import { isStrongSystemPassword } from "@/lib/system/passwordPolicy";
import { dbAdmin } from "@/lib/system/dbAdmin";

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

const Body = z.object({
  email: Email,
  fullName: z.preprocess(trimToUndefined, z.string().max(120).optional()),
  phone: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1).max(40)
  ),
  password: z.preprocess((value) => (typeof value === "string" ? value : ""), z.string().min(1).max(64)),
  reason: z.preprocess(trimToUndefined, z.string().max(500).optional())
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBody(req: Request) {
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
    email: data.email ?? data.userEmail ?? data.mail,
    fullName: data.fullName ?? data.full_name ?? data.name ?? data.username,
    phone: data.phone ?? data.phone_number ?? data.mobile,
    password: data.password ?? data.initialPassword ?? data.initial_password ?? data.pass,
    reason: data.reason ?? data.note
  };
}

export async function POST(req: Request) {
  try {
    const { user: actor } = await requireSuperAdmin();

    const parsed = Body.safeParse(normalizeBody(await readBody(req)));
    if (!parsed.success) {
      return json({ ok: false, error: "INVALID_BODY", details: parsed.error.flatten() }, 400);
    }

    const email = parsed.data.email.trim().toLowerCase();
    const phoneRaw = parsed.data.phone.trim();
    const phone = phoneRaw.replace(/[\s-]/g, "");
    if (!phone || !PHONE_REGEX.test(phone)) {
      return json({ ok: false, error: "INVALID_PHONE" }, 400);
    }
    if (!isStrongSystemPassword(parsed.data.password)) {
      return json({ ok: false, error: "WEAK_PASSWORD" }, 400);
    }

    const admin = dbAdmin();

    const created = await admin.auth.admin.createUser({
      email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: parsed.data.fullName ? { full_name: parsed.data.fullName } : undefined
    });

    if (created.error || !created.data.user?.id) {
      return json({ ok: false, error: created.error?.message || "AUTH_CREATE_FAILED" }, 500);
    }

    const userId = created.data.user.id;
    const now = new Date().toISOString();

    const upsertProfile = await admin.from("profiles").upsert(
      {
        id: userId,
        email,
        full_name: parsed.data.fullName || null,
        phone,
        role: "leader",
        leader_id: null,
        status: "active",
        created_at: now,
        updated_at: now
      } as any,
      { onConflict: "id" }
    );

    if (upsertProfile.error) {
      await admin.auth.admin.deleteUser(userId);
      return json({ ok: false, error: upsertProfile.error.message }, 500);
    }

    const passwordInit = await admin.auth.admin.updateUserById(userId, {
      password: parsed.data.password
    });
    if (passwordInit.error) {
      await admin.auth.admin.deleteUser(userId);
      return json({ ok: false, error: passwordInit.error.message || "PASSWORD_INIT_FAILED" }, 500);
    }

    const audit = await admin.from("role_audit_logs").insert({
      target_id: userId,
      actor_id: actor.id,
      from_role: "student",
      to_role: "leader",
      reason: parsed.data.reason?.trim() || "create_leader",
      created_at: now
    } as any);

    if (audit.error) {
      return json({ ok: true, id: userId, audit: "FAILED" });
    }

    return json({ ok: true, id: userId });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}

