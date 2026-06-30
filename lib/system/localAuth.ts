import "server-only";

import { scrypt as scryptCallback, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";

import { dbFirst, dbRun } from "@/lib/d1";

async function scryptBuffer(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) {
  return await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived as Buffer);
    });
  });
}

const HASH_ALGO = "scrypt";
// Keep bcrypt cost moderate for Cloudflare Worker CPU limits.
const BCRYPT_ROUNDS = 6;

type LocalAuthRow = {
  user_id: string;
  email: string;
  password_hash: string;
};

type ProfileEmailRow = {
  id: string;
  email: string | null;
};

const g = globalThis as { __fx_local_auth_schema_ready?: boolean };

function isMissingSchemaError(err: unknown) {
  const message = String((err as any)?.message || "").toLowerCase();
  return message.includes("no such table") || message.includes("no such column");
}

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function parseHashPayload(encoded: string) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 6) return null;
  const [algo, n, r, p, saltBase64, hashBase64] = parts;
  if (algo !== HASH_ALGO) return null;
  const nn = Number(n);
  const rr = Number(r);
  const pp = Number(p);
  if (!Number.isFinite(nn) || !Number.isFinite(rr) || !Number.isFinite(pp)) return null;
  try {
    const salt = Buffer.from(saltBase64, "base64");
    const hash = Buffer.from(hashBase64, "base64");
    if (!salt.length || !hash.length) return null;
    return { n: nn, r: rr, p: pp, salt, hash };
  } catch {
    return null;
  }
}

function isBcryptHash(encoded: string) {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(encoded || ""));
}

export async function ensureLocalAuthSchema() {
  if (g.__fx_local_auth_schema_ready) return;
  await dbRun(`
    create table if not exists local_auth_users (
      user_id text primary key references profiles(id) on delete cascade,
      email text not null unique,
      password_hash text not null,
      password_updated_at text not null default (CURRENT_TIMESTAMP),
      created_at text not null default (CURRENT_TIMESTAMP),
      updated_at text not null default (CURRENT_TIMESTAMP)
    )
  `);
  await dbRun(`
    create index if not exists local_auth_users_email_idx
    on local_auth_users (email)
  `);
  g.__fx_local_auth_schema_ready = true;
}

export async function hashLocalPassword(password: string) {
  return await bcrypt.hash(String(password || ""), BCRYPT_ROUNDS);
}

export async function verifyLocalPassword(password: string, encoded: string) {
  if (isBcryptHash(encoded)) {
    return bcrypt.compare(String(password || ""), encoded);
  }
  const parsed = parseHashPayload(encoded);
  if (!parsed) return false;
  const derived = await scryptBuffer(String(password || ""), parsed.salt, parsed.hash.length, {
    N: parsed.n,
    r: parsed.r,
    p: parsed.p
  });
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

export async function findLocalAuthByEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  try {
    return (
      (await dbFirst<LocalAuthRow>(
        "select user_id, email, password_hash from local_auth_users where lower(email) = lower(?) limit 1",
        [normalized]
      )) || null
    );
  } catch (err) {
    if (isMissingSchemaError(err)) return null;
    throw err;
  }
}

export async function findLocalAuthByUserId(userId: string) {
  if (!userId) return null;
  try {
    return (
      (await dbFirst<LocalAuthRow>(
        "select user_id, email, password_hash from local_auth_users where user_id = ? limit 1",
        [userId]
      )) || null
    );
  } catch (err) {
    if (isMissingSchemaError(err)) return null;
    throw err;
  }
}

export async function upsertLocalAuthUser(input: {
  userId: string;
  email: string;
  password: string;
}) {
  await ensureLocalAuthSchema();
  const userId = String(input.userId || "").trim();
  const email = normalizeEmail(input.email);
  if (!userId) throw new Error("LOCAL_AUTH_INVALID_USER_ID");
  if (!email) throw new Error("LOCAL_AUTH_INVALID_EMAIL");
  const hash = await hashLocalPassword(input.password);
  const now = new Date().toISOString();

  const existingByEmail = await dbFirst<{ user_id: string }>(
    "select user_id from local_auth_users where lower(email) = lower(?) limit 1",
    [email]
  );
  if (existingByEmail?.user_id && existingByEmail.user_id !== userId) {
    throw new Error("LOCAL_AUTH_EMAIL_EXISTS");
  }

  await dbRun(
    `insert into local_auth_users (user_id, email, password_hash, password_updated_at, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict(user_id) do update set
       email = excluded.email,
       password_hash = excluded.password_hash,
       password_updated_at = excluded.password_updated_at,
       updated_at = excluded.updated_at`,
    [userId, email, hash, now, now, now]
  );

  return { userId, email };
}

export async function ensureLocalAuthForUserId(userId: string, password: string) {
  await ensureLocalAuthSchema();
  const existing = await findLocalAuthByUserId(userId);
  if (existing?.user_id) {
    return upsertLocalAuthUser({ userId, email: existing.email, password });
  }
  const profile = await dbFirst<ProfileEmailRow>(
    "select id, email from profiles where id = ? limit 1",
    [userId]
  );
  if (!profile?.id || !profile.email) throw new Error("LOCAL_AUTH_PROFILE_EMAIL_MISSING");
  return upsertLocalAuthUser({ userId, email: profile.email, password });
}

export async function updateLocalAuthPasswordByUserId(userId: string, password: string) {
  await ensureLocalAuthSchema();
  const existing = await findLocalAuthByUserId(userId);
  if (existing?.user_id) {
    const hash = await hashLocalPassword(password);
    const now = new Date().toISOString();
    await dbRun(
      "update local_auth_users set password_hash = ?, password_updated_at = ?, updated_at = ? where user_id = ?",
      [hash, now, now, userId]
    );
    return { userId, email: existing.email };
  }
  return ensureLocalAuthForUserId(userId, password);
}

export async function verifyLocalAuthCredentials(email: string, password: string) {
  const row = await findLocalAuthByEmail(email);
  if (!row?.user_id) return null;
  const ok = await verifyLocalPassword(password, row.password_hash);
  if (!ok) return null;
  return { userId: row.user_id, email: normalizeEmail(row.email) };
}

export async function deleteLocalAuthUser(userId: string) {
  await ensureLocalAuthSchema();
  if (!userId) return;
  await dbRun("delete from local_auth_users where user_id = ?", [userId]);
}

export async function renameLocalAuthEmail(userId: string, email: string) {
  await ensureLocalAuthSchema();
  const normalized = normalizeEmail(email);
  if (!userId || !normalized) return;
  const existingByEmail = await dbFirst<{ user_id: string }>(
    "select user_id from local_auth_users where lower(email) = lower(?) limit 1",
    [normalized]
  );
  if (existingByEmail?.user_id && existingByEmail.user_id !== userId) {
    throw new Error("LOCAL_AUTH_EMAIL_EXISTS");
  }
  const now = new Date().toISOString();
  await dbRun("update local_auth_users set email = ?, updated_at = ? where user_id = ?", [
    normalized,
    now,
    userId
  ]);
}
