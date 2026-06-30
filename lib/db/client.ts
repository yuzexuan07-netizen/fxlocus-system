import "server-only";

import { cookies } from "next/headers";

import { buildSqlInFilter, dbAll, dbFirst, dbRun, sqlPlaceholders, type D1Row } from "@/lib/d1";
import {
  deleteLocalAuthUser,
  renameLocalAuthEmail,
  updateLocalAuthPasswordByUserId,
  verifyLocalAuthCredentials
} from "@/lib/system/localAuth";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import {
  getR2Bucket,
  r2DeleteObjects,
  r2Enabled,
  r2PresignGet,
  r2PresignPut,
  r2PublicUrl,
  r2UploadBuffer
} from "@/lib/storage/r2";

type DbLikeError = {
  message: string;
  code?: string;
};

type DbLikeResult<T> = {
  data: T;
  error: DbLikeError | null;
  count: number | null;
};

type ProfileAuthRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  status: string | null;
  session_id?: string | null;
};

type SortDirection = {
  ascending?: boolean;
};

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const JSON_EACH_IN_THRESHOLD = 50;

function quoteIdentifier(identifier: string) {
  const value = String(identifier || "").trim();
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(`INVALID_IDENTIFIER:${identifier}`);
  }
  return `"${value}"`;
}

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function isMissingColumnError(message: string) {
  return /no such column/i.test(message);
}

function isMissingTableError(message: string) {
  return /no such table/i.test(message);
}

function normalizeError(error: unknown): DbLikeError {
  const message = String((error as any)?.message || error || "UNKNOWN_ERROR");
  let code: string | undefined;
  if (isMissingColumnError(message)) code = "42703";
  else if (isMissingTableError(message)) code = "42P01";
  else if (/unique constraint failed/i.test(message)) code = "23505";
  else if (/foreign key constraint failed/i.test(message)) code = "23503";
  return { message, code };
}

function okResult<T>(data: T, count: number | null = null): DbLikeResult<T> {
  return { data, error: null, count };
}

function errResult<T>(error: unknown, data: T, count: number | null = null): DbLikeResult<T> {
  return { data, error: normalizeError(error), count };
}

function splitTopLevel(input: string, delimiter = ",") {
  const text = String(input || "");
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === delimiter && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseSelectColumns(columns: string) {
  const raw = String(columns || "*").trim();
  if (!raw || raw === "*") return "*";
  const items = splitTopLevel(raw, ",");
  const sqlItems = items.map((item) => {
    if (item === "*") return "*";
    if (item.includes("(") || item.includes(")") || item.includes(":")) {
      throw new Error(`UNSUPPORTED_SELECT_SYNTAX:${item}`);
    }

    const asMatch = item.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (asMatch) {
      return `${quoteIdentifier(asMatch[1])} as ${quoteIdentifier(asMatch[2])}`;
    }
    return quoteIdentifier(item);
  });
  return sqlItems.join(", ");
}

function parseOrClause(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return { sql: "", params: [] as unknown[] };
  const tokens = splitTopLevel(raw, ",");
  const fragments: string[] = [];
  const params: unknown[] = [];

  for (const token of tokens) {
    const firstDot = token.indexOf(".");
    const secondDot = token.indexOf(".", firstDot + 1);
    if (firstDot <= 0 || secondDot <= firstDot + 1) continue;
    const column = token.slice(0, firstDot).trim();
    const operator = token.slice(firstDot + 1, secondDot).trim().toLowerCase();
    const rhsRaw = token.slice(secondDot + 1).trim();
    const rhs = rhsRaw.includes("%") ? decodeURIComponent(rhsRaw) : rhsRaw;
    const quotedColumn = quoteIdentifier(column);

    if (operator === "eq") {
      fragments.push(`${quotedColumn} = ?`);
      params.push(normalizeValue(rhs));
      continue;
    }
    if (operator === "neq") {
      fragments.push(`${quotedColumn} <> ?`);
      params.push(normalizeValue(rhs));
      continue;
    }
    if (operator === "ilike") {
      fragments.push(`lower(${quotedColumn}) like lower(?)`);
      params.push(rhs);
      continue;
    }
    if (operator === "like") {
      fragments.push(`${quotedColumn} like ?`);
      params.push(rhs);
      continue;
    }
    if (operator === "is") {
      if (rhs.toLowerCase() === "null") {
        fragments.push(`${quotedColumn} is null`);
      } else {
        fragments.push(`${quotedColumn} is ?`);
        params.push(normalizeValue(rhs));
      }
      continue;
    }
    if (operator === "in") {
      const listRaw = rhs.startsWith("(") && rhs.endsWith(")") ? rhs.slice(1, -1) : rhs;
      const list = splitTopLevel(listRaw, ",");
      if (!list.length) {
        fragments.push("1 = 0");
      } else {
        fragments.push(`${quotedColumn} in (${sqlPlaceholders(list.length)})`);
        params.push(...list.map((item) => normalizeValue(item)));
      }
    }
  }

  if (!fragments.length) return { sql: "", params: [] as unknown[] };
  return { sql: `(${fragments.join(" OR ")})`, params };
}

function getCookieStoreSafe() {
  try {
    return cookies();
  } catch {
    return null;
  }
}

function getSessionIdCandidates() {
  const cookieStore = getCookieStoreSafe();
  if (!cookieStore) return [];
  const values: string[] = [];
  const seen = new Set<string>();
  const all = cookieStore.getAll().filter((item) => item.name === "fxlocus_session_id");
  for (const item of all) {
    const value = String(item.value || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

async function findProfileBySessionId(sessionId: string): Promise<ProfileAuthRow | null> {
  if (!sessionId) return null;
  const row = await dbFirst<ProfileAuthRow>(
    "select id, email, full_name, role, status, session_id from profiles where session_id = ? limit 1",
    [sessionId]
  );
  return row || null;
}

async function findProfileByUserId(userId: string): Promise<ProfileAuthRow | null> {
  if (!userId) return null;
  const row = await dbFirst<ProfileAuthRow>(
    "select id, email, full_name, role, status, session_id from profiles where id = ? limit 1",
    [userId]
  );
  return row || null;
}

function setSessionCookie(sessionId: string) {
  const cookieStore = getCookieStoreSafe();
  if (!cookieStore) return;
  try {
    cookieStore.set("fxlocus_session_id", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: DEFAULT_SESSION_TTL_SECONDS
    });
  } catch {
    // ignore when response cookies are not writable in this context
  }
}

function clearSessionCookie() {
  const cookieStore = getCookieStoreSafe();
  if (!cookieStore) return;
  try {
    cookieStore.set("fxlocus_session_id", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0
    });
  } catch {
    // ignore when response cookies are not writable in this context
  }
}

async function resolveCurrentUserBySession() {
  const sessionCandidates = getSessionIdCandidates();
  for (const sessionId of sessionCandidates) {
    const profile = await findProfileBySessionId(sessionId);
    if (profile?.id) return profile;
  }
  return null;
}

function pickUploadContentType(options?: { contentType?: string; [key: string]: unknown } | null) {
  const contentType = String(options?.contentType || "").trim();
  return contentType || "application/octet-stream";
}

class D1StorageBucketApi {
  constructor(private readonly bucket: string) {}

  async createSignedUrl(path: string, expiresIn = 3600) {
    try {
      if (!path) return errResult({ message: "EMPTY_PATH" }, null);
      if (!r2Enabled()) {
        const publicUrl = r2PublicUrl(path);
        if (!publicUrl) return errResult({ message: "R2_NOT_CONFIGURED" }, null);
        return okResult({ signedUrl: publicUrl, path });
      }
      const signedUrl = await r2PresignGet(path, expiresIn);
      return okResult({ signedUrl, path });
    } catch (error) {
      return errResult(error, null);
    }
  }

  async createSignedUploadUrl(path: string) {
    try {
      if (!path) return errResult({ message: "EMPTY_PATH" }, null);
      if (!r2Enabled()) return errResult({ message: "R2_NOT_CONFIGURED" }, null);
      const uploadUrl = await r2PresignPut(path, "application/octet-stream", 3600);
      return okResult({ path, token: null, signedUrl: uploadUrl, uploadUrl });
    } catch (error) {
      return errResult(error, null);
    }
  }

  async upload(
    path: string,
    body: Buffer | ArrayBuffer | Uint8Array,
    options?: { contentType?: string; [key: string]: unknown }
  ) {
    try {
      if (!path) return errResult({ message: "EMPTY_PATH" }, null);
      if (!r2Enabled()) return errResult({ message: "R2_NOT_CONFIGURED" }, null);
      await r2UploadBuffer(path, body, pickUploadContentType(options));
      return okResult({ path });
    } catch (error) {
      return errResult(error, null);
    }
  }

  async remove(paths: string[]) {
    try {
      const normalized = (paths || []).map((item) => String(item || "").trim()).filter(Boolean);
      if (!normalized.length) return okResult([]);
      if (!r2Enabled()) return errResult({ message: "R2_NOT_CONFIGURED" }, null);
      await r2DeleteObjects(normalized);
      return okResult(normalized);
    } catch (error) {
      return errResult(error, null);
    }
  }
}

class D1StorageApi {
  from(bucket: string) {
    return new D1StorageBucketApi(String(bucket || ""));
  }

  async listBuckets() {
    try {
      const name = getR2Bucket();
      const data = name ? [{ id: name, name, public: false }] : [];
      return okResult(data);
    } catch (error) {
      return errResult(error, [] as any[]);
    }
  }

  async createBucket(name: string, _options?: Record<string, unknown>) {
    try {
      const bucket = String(name || "").trim();
      if (!bucket) return errResult({ message: "INVALID_BUCKET_NAME" }, null);
      return okResult({ id: bucket, name: bucket, public: false });
    } catch (error) {
      return errResult(error, null);
    }
  }
}

class D1AuthAdminApi {
  async createUser(input: {
    email?: string;
    password?: string;
    user_metadata?: Record<string, unknown> | null;
    [key: string]: unknown;
  }) {
    try {
      const email = normalizeEmail(String(input?.email || ""));
      const password = String(input?.password || "");
      if (!email || !password) {
        return errResult({ message: "INVALID_AUTH_INPUT" }, { user: null });
      }

      const existingLocal = await dbFirst<{ user_id: string }>(
        "select user_id from local_auth_users where lower(email) = lower(?) limit 1",
        [email]
      );
      if (existingLocal?.user_id) {
        return errResult({ message: "User already registered" }, { user: null });
      }

      const existingProfile = await dbFirst<{ id: string }>(
        "select id from profiles where lower(email) = lower(?) limit 1",
        [email]
      );
      if (existingProfile?.id) {
        return errResult({ message: "User already registered" }, { user: null });
      }

      const userId = crypto.randomUUID();
      const user = {
        id: userId,
        email,
        user_metadata: input?.user_metadata || {}
      };
      return okResult({ user });
    } catch (error) {
      return errResult(error, { user: null });
    }
  }

  async deleteUser(userId: string) {
    try {
      const id = String(userId || "").trim();
      if (!id) return errResult({ message: "INVALID_USER_ID" }, { user: null });

      await deleteLocalAuthUser(id);
      await dbRun("delete from profiles where id = ?", [id]);

      return okResult({ user: { id } });
    } catch (error) {
      return errResult(error, { user: null });
    }
  }

  async updateUserById(
    userId: string,
    patch: {
      email?: string;
      password?: string;
      user_metadata?: Record<string, unknown> | null;
      [key: string]: unknown;
    }
  ) {
    try {
      const id = String(userId || "").trim();
      if (!id) return errResult({ message: "INVALID_USER_ID" }, { user: null });

      if (patch?.password) {
        await updateLocalAuthPasswordByUserId(id, String(patch.password));
      }

      if (patch?.email) {
        const normalized = normalizeEmail(String(patch.email));
        await renameLocalAuthEmail(id, normalized);
        await dbRun("update profiles set email = ?, updated_at = ? where id = ?", [
          normalized,
          new Date().toISOString(),
          id
        ]);
      }

      const nextName = String((patch?.user_metadata as any)?.full_name || "").trim();
      if (nextName) {
        await dbRun("update profiles set full_name = ?, updated_at = ? where id = ?", [
          nextName,
          new Date().toISOString(),
          id
        ]);
      }

      const profile = await findProfileByUserId(id);
      return okResult({
        user: {
          id,
          email: profile?.email || null,
          user_metadata: {
            full_name: profile?.full_name || null
          }
        }
      });
    } catch (error) {
      return errResult(error, { user: null });
    }
  }
}

class D1AuthApi {
  readonly admin = new D1AuthAdminApi();

  constructor(private readonly explicitUserId: string | null = null) {}

  private async resolveCurrentUserId() {
    if (this.explicitUserId) return this.explicitUserId;
    const current = await resolveCurrentUserBySession();
    return current?.id || null;
  }

  async getSession() {
    try {
      const profile = await resolveCurrentUserBySession();
      if (!profile?.id) {
        return okResult({ session: null });
      }
      const now = Math.floor(Date.now() / 1000);
      const session = {
        access_token: String(profile.session_id || profile.id),
        token_type: "bearer",
        expires_at: now + DEFAULT_SESSION_TTL_SECONDS,
        user: {
          id: profile.id,
          email: profile.email
        }
      };
      return okResult({ session });
    } catch (error) {
      return errResult(error, { session: null });
    }
  }

  async getUser(token?: string) {
    try {
      const normalizedToken = String(token || "").trim();
      let profile: ProfileAuthRow | null = null;
      if (normalizedToken) {
        profile =
          (await dbFirst<ProfileAuthRow>(
            "select id, email, full_name, role, status, session_id from profiles where session_id = ? limit 1",
            [normalizedToken]
          )) || null;
        if (!profile?.id && /^[0-9a-f-]{36}$/i.test(normalizedToken)) {
          profile = await findProfileByUserId(normalizedToken);
        }
      } else {
        profile = await resolveCurrentUserBySession();
      }

      if (!profile?.id) return okResult({ user: null });
      return okResult({
        user: {
          id: profile.id,
          email: profile.email,
          user_metadata: {
            full_name: profile.full_name || null
          }
        }
      });
    } catch (error) {
      return errResult(error, { user: null });
    }
  }

  async signInWithPassword(input: { email?: string; password?: string }) {
    try {
      const email = normalizeEmail(String(input?.email || ""));
      const password = String(input?.password || "");
      const matched = await verifyLocalAuthCredentials(email, password);
      if (!matched?.userId) {
        return errResult({ message: "Invalid login credentials" }, { user: null, session: null });
      }

      const userId = matched.userId;
      const sessionId = crypto.randomUUID();
      const now = new Date().toISOString();

      await dbRun(
        "update profiles set session_id = ?, last_login_at = ?, updated_at = ? where id = ?",
        [sessionId, now, now, userId]
      );
      setSessionCookie(sessionId);

      const profile = await findProfileByUserId(userId);
      const nowSec = Math.floor(Date.now() / 1000);
      return okResult({
        user: {
          id: userId,
          email: profile?.email || matched.email || email,
          user_metadata: {
            full_name: profile?.full_name || null
          }
        },
        session: {
          access_token: sessionId,
          token_type: "bearer",
          expires_at: nowSec + DEFAULT_SESSION_TTL_SECONDS,
          user: {
            id: userId,
            email: profile?.email || matched.email || email
          }
        }
      });
    } catch (error) {
      return errResult(error, { user: null, session: null });
    }
  }

  async updateUser(input: { email?: string; password?: string; data?: Record<string, unknown> }) {
    try {
      const currentUserId = await this.resolveCurrentUserId();
      if (!currentUserId) return errResult({ message: "UNAUTHORIZED" }, { user: null });

      if (input?.password) {
        await updateLocalAuthPasswordByUserId(currentUserId, String(input.password));
      }
      if (input?.email) {
        const normalized = normalizeEmail(String(input.email));
        await renameLocalAuthEmail(currentUserId, normalized);
        await dbRun("update profiles set email = ?, updated_at = ? where id = ?", [
          normalized,
          new Date().toISOString(),
          currentUserId
        ]);
      }
      const fullName = String((input?.data as any)?.full_name || "").trim();
      if (fullName) {
        await dbRun("update profiles set full_name = ?, updated_at = ? where id = ?", [
          fullName,
          new Date().toISOString(),
          currentUserId
        ]);
      }

      const profile = await findProfileByUserId(currentUserId);
      return okResult({
        user: {
          id: currentUserId,
          email: profile?.email || null,
          user_metadata: {
            full_name: profile?.full_name || null
          }
        }
      });
    } catch (error) {
      return errResult(error, { user: null });
    }
  }

  async signOut() {
    try {
      const sessionCandidates = getSessionIdCandidates();
      if (sessionCandidates.length) {
        await dbRun(
          `update profiles set session_id = null, updated_at = ?
           where session_id in (${sqlPlaceholders(sessionCandidates.length)})`,
          [new Date().toISOString(), ...sessionCandidates]
        );
      }
      clearSessionCookie();
      return okResult(null);
    } catch (error) {
      return errResult(error, null);
    }
  }
}

type FilterItem = {
  sql: string;
  params: unknown[];
};

type QueryAction = "select" | "insert" | "update" | "upsert" | "delete";

class D1QueryBuilder<TData = any[]> implements PromiseLike<DbLikeResult<TData>> {
  private action: QueryAction = "select";
  private selectColumns = "*";
  private didCallSelect = false;
  private selectCountExact = false;
  private selectHead = false;
  private filters: FilterItem[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private singleMode: "none" | "single" | "maybeSingle" = "none";
  private insertRows: Record<string, unknown>[] = [];
  private updateValues: Record<string, unknown> | null = null;
  private upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } | null = null;

  constructor(private readonly table: string) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.didCallSelect = true;
    this.selectColumns = String(columns || "*");
    this.selectCountExact = options?.count === "exact";
    this.selectHead = Boolean(options?.head);
    return this as unknown as D1QueryBuilder<any[]>;
  }

  eq(column: string, value: unknown) {
    const quoted = quoteIdentifier(column);
    if (value === null || value === undefined) {
      this.filters.push({ sql: `${quoted} is null`, params: [] });
    } else {
      this.filters.push({ sql: `${quoted} = ?`, params: [normalizeValue(value)] });
    }
    return this as unknown as D1QueryBuilder<TData>;
  }

  is(column: string, value: unknown) {
    const quoted = quoteIdentifier(column);
    if (value === null || value === undefined) {
      this.filters.push({ sql: `${quoted} is null`, params: [] });
    } else {
      this.filters.push({ sql: `${quoted} is ?`, params: [normalizeValue(value)] });
    }
    return this as unknown as D1QueryBuilder<TData>;
  }

  in(column: string, values: readonly unknown[]) {
    const list = Array.isArray(values) ? Array.from(values).map((item) => normalizeValue(item)) : [];
    if (!list.length) {
      this.filters.push({ sql: "1 = 0", params: [] });
      return this as unknown as D1QueryBuilder<TData>;
    }
    const quoted = quoteIdentifier(column);
    if (list.length > JSON_EACH_IN_THRESHOLD) {
      this.filters.push({
        sql: `${quoted} in (select value from json_each(?))`,
        params: [JSON.stringify(list)]
      });
      return this as unknown as D1QueryBuilder<TData>;
    }
    this.filters.push({
      sql: `${quoted} in (${sqlPlaceholders(list.length)})`,
      params: list
    });
    return this as unknown as D1QueryBuilder<TData>;
  }

  ilike(column: string, pattern: string) {
    const quoted = quoteIdentifier(column);
    this.filters.push({
      sql: `lower(${quoted}) like lower(?)`,
      params: [String(pattern || "")]
    });
    return this as unknown as D1QueryBuilder<TData>;
  }

  or(expression: string) {
    const parsed = parseOrClause(expression);
    if (parsed.sql) {
      this.filters.push({ sql: parsed.sql, params: parsed.params });
    }
    return this as unknown as D1QueryBuilder<TData>;
  }

  filter(column: string, operator: string, value: unknown) {
    const op = String(operator || "").trim().toLowerCase();
    if (op === "eq") return this.eq(column, value);
    if (op === "neq") {
      const quoted = quoteIdentifier(column);
      this.filters.push({ sql: `${quoted} <> ?`, params: [normalizeValue(value)] });
      return this as unknown as D1QueryBuilder<TData>;
    }
    if (op === "ilike") return this.ilike(column, String(value ?? ""));
    if (op === "like") {
      const quoted = quoteIdentifier(column);
      this.filters.push({ sql: `${quoted} like ?`, params: [String(value ?? "")] });
      return this as unknown as D1QueryBuilder<TData>;
    }
    throw new Error(`UNSUPPORTED_FILTER_OPERATOR:${operator}`);
  }

  order(column: string, options?: SortDirection) {
    this.orders.push({
      column,
      ascending: options?.ascending !== false
    });
    return this as unknown as D1QueryBuilder<TData>;
  }

  range(from: number, to: number) {
    const safeFrom = Number.isFinite(from) ? Math.max(0, Math.floor(from)) : 0;
    const safeTo = Number.isFinite(to) ? Math.max(safeFrom, Math.floor(to)) : safeFrom;
    this.offsetValue = safeFrom;
    this.limitValue = safeTo - safeFrom + 1;
    return this as unknown as D1QueryBuilder<TData>;
  }

  limit(value: number) {
    this.limitValue = Math.max(0, Math.floor(Number(value || 0)));
    return this as unknown as D1QueryBuilder<TData>;
  }

  insert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.action = "insert";
    const rows = Array.isArray(payload) ? payload : [payload];
    this.insertRows = rows.map((row) => ({ ...(row || {}) }));
    return this as unknown as D1QueryBuilder<any[]>;
  }

  update(payload: Record<string, unknown>) {
    this.action = "update";
    this.updateValues = { ...(payload || {}) };
    return this as unknown as D1QueryBuilder<any[]>;
  }

  upsert(
    payload: Record<string, unknown> | Array<Record<string, unknown>>,
    options?: { onConflict?: string; ignoreDuplicates?: boolean }
  ) {
    this.action = "upsert";
    const rows = Array.isArray(payload) ? payload : [payload];
    this.insertRows = rows.map((row) => ({ ...(row || {}) }));
    this.upsertOptions = {
      onConflict: options?.onConflict,
      ignoreDuplicates: Boolean(options?.ignoreDuplicates)
    };
    return this as unknown as D1QueryBuilder<any[]>;
  }

  delete() {
    this.action = "delete";
    return this as unknown as D1QueryBuilder<any[]>;
  }

  single() {
    this.singleMode = "single";
    if (this.limitValue === null) this.limitValue = 2;
    return this as unknown as D1QueryBuilder<any>;
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    if (this.limitValue === null) this.limitValue = 1;
    return this as unknown as D1QueryBuilder<any | null>;
  }

  private buildWhereSql() {
    if (!this.filters.length) return { sql: "", params: [] as unknown[] };
    const sql = this.filters.map((item) => item.sql).join(" and ");
    const params = this.filters.flatMap((item) => item.params);
    return { sql: ` where ${sql}`, params };
  }

  private buildOrderSql() {
    if (!this.orders.length) return "";
    const by = this.orders
      .map((item) => `${quoteIdentifier(item.column)} ${item.ascending ? "asc" : "desc"}`)
      .join(", ");
    return ` order by ${by}`;
  }

  private buildLimitSql() {
    let sql = "";
    const params: unknown[] = [];
    if (typeof this.limitValue === "number") {
      sql += " limit ?";
      params.push(this.limitValue);
    }
    if (typeof this.offsetValue === "number") {
      if (typeof this.limitValue !== "number") {
        sql += " limit -1";
      }
      sql += " offset ?";
      params.push(this.offsetValue);
    }
    return { sql, params };
  }

  private getTableSql() {
    return quoteIdentifier(this.table);
  }

  private async executeSelect(): Promise<DbLikeResult<any>> {
    try {
      const tableSql = this.getTableSql();
      const where = this.buildWhereSql();
      const orderSql = this.buildOrderSql();
      const limit = this.buildLimitSql();
      let count: number | null = null;

      if (this.selectCountExact) {
        const countRow = await dbFirst<{ __count: number }>(
          `select count(*) as __count from ${tableSql}${where.sql}`,
          where.params
        );
        count = Number(countRow?.__count || 0);
      }

      if (this.selectHead) {
        return okResult(null, count);
      }

      const columnsSql = parseSelectColumns(this.selectColumns);
      const rows = await dbAll<D1Row>(
        `select ${columnsSql} from ${tableSql}${where.sql}${orderSql}${limit.sql}`,
        [...where.params, ...limit.params]
      );

      if (this.singleMode === "single") {
        if (!rows.length) {
          return errResult({ message: "No rows found", code: "PGRST116" }, null, count);
        }
        if (rows.length > 1) {
          return errResult({ message: "Multiple rows found", code: "PGRST117" }, null, count);
        }
        return okResult(rows[0], count);
      }

      if (this.singleMode === "maybeSingle") {
        return okResult(rows.length ? rows[0] : null, count);
      }

      return okResult(rows, count);
    } catch (error) {
      return errResult(error, this.singleMode === "none" ? [] : null, null);
    }
  }

  private normalizeRowsForWrite() {
    return this.insertRows
      .map((row) => {
        const out: Record<string, unknown> = {};
        Object.entries(row || {}).forEach(([key, value]) => {
          if (value === undefined) return;
          out[key] = normalizeValue(value);
        });
        return out;
      })
      .filter((row) => Object.keys(row).length > 0);
  }

  private async executeInsertLike(mode: "insert" | "upsert"): Promise<DbLikeResult<any>> {
    try {
      const tableSql = this.getTableSql();
      const rows = this.normalizeRowsForWrite();
      if (!rows.length) {
        return okResult(this.singleMode === "none" ? [] : null);
      }

      for (const row of rows) {
        const keys = Object.keys(row);
        const columnsSql = keys.map((key) => quoteIdentifier(key)).join(", ");
        const valuesSql = sqlPlaceholders(keys.length);
        const values = keys.map((key) => row[key]);

        let sql = `insert into ${tableSql} (${columnsSql}) values (${valuesSql})`;
        if (mode === "upsert") {
          const rawConflict = String(this.upsertOptions?.onConflict || "").trim();
          const conflictColumns = rawConflict
            ? rawConflict
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
            : ["id"];
          const conflictSql = conflictColumns.map((item) => quoteIdentifier(item)).join(", ");
          if (this.upsertOptions?.ignoreDuplicates) {
            sql += ` on conflict (${conflictSql}) do nothing`;
          } else {
            const updateColumns = keys.filter((key) => !conflictColumns.includes(key));
            if (!updateColumns.length) {
              sql += ` on conflict (${conflictSql}) do nothing`;
            } else {
              sql += ` on conflict (${conflictSql}) do update set ${updateColumns
                .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
                .join(", ")}`;
            }
          }
        }
        await dbRun(sql, values);
      }

      const out = this.singleMode === "none" ? rows : rows[0] || null;
      return okResult(out);
    } catch (error) {
      return errResult(error, this.singleMode === "none" ? [] : null);
    }
  }

  private async executeUpdate(): Promise<DbLikeResult<any>> {
    try {
      const row = this.updateValues || {};
      const entries = Object.entries(row).filter(([, value]) => value !== undefined);
      if (!entries.length) return errResult({ message: "EMPTY_UPDATE" }, null);

      const setSql = entries
        .map(([key]) => `${quoteIdentifier(key)} = ?`)
        .join(", ");
      const setParams = entries.map(([, value]) => normalizeValue(value));
      const where = this.buildWhereSql();
      const tableSql = this.getTableSql();
      await dbRun(`update ${tableSql} set ${setSql}${where.sql}`, [...setParams, ...where.params]);
      if (!this.didCallSelect && this.singleMode === "none") {
        return okResult([]);
      }

      const columnsSql = parseSelectColumns(this.selectColumns);
      const orderSql = this.buildOrderSql();
      const limit = this.buildLimitSql();
      const rows = await dbAll<D1Row>(
        `select ${columnsSql} from ${tableSql}${where.sql}${orderSql}${limit.sql}`,
        [...where.params, ...limit.params]
      );

      if (this.singleMode === "single") {
        if (!rows.length) {
          return errResult({ message: "No rows found", code: "PGRST116" }, null);
        }
        if (rows.length > 1) {
          return errResult({ message: "Multiple rows found", code: "PGRST117" }, null);
        }
        return okResult(rows[0]);
      }

      if (this.singleMode === "maybeSingle") {
        return okResult(rows.length ? rows[0] : null);
      }

      return okResult(rows);
    } catch (error) {
      return errResult(error, this.singleMode === "none" ? [] : null);
    }
  }

  private async executeDelete(): Promise<DbLikeResult<any>> {
    try {
      const tableSql = this.getTableSql();
      const where = this.buildWhereSql();
      await dbRun(`delete from ${tableSql}${where.sql}`, where.params);
      return okResult(this.singleMode === "none" ? [] : null);
    } catch (error) {
      return errResult(error, this.singleMode === "none" ? [] : null);
    }
  }

  async execute(): Promise<DbLikeResult<TData>> {
    if (this.action === "select") return (await this.executeSelect()) as DbLikeResult<TData>;
    if (this.action === "insert") return (await this.executeInsertLike("insert")) as DbLikeResult<TData>;
    if (this.action === "upsert") return (await this.executeInsertLike("upsert")) as DbLikeResult<TData>;
    if (this.action === "update") return (await this.executeUpdate()) as DbLikeResult<TData>;
    return (await this.executeDelete()) as DbLikeResult<TData>;
  }

  then<TResult1 = DbLikeResult<TData>, TResult2 = never>(
    onfulfilled?: ((value: DbLikeResult<TData>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class D1DbClient {
  readonly auth: D1AuthApi;
  readonly storage = new D1StorageApi();

  constructor(private readonly currentUserId: string | null = null) {
    this.auth = new D1AuthApi(currentUserId);
  }

  from(table: string) {
    return new D1QueryBuilder<any[]>(String(table || "").trim());
  }

  async rpc(name: string, params?: Record<string, unknown>) {
    try {
      const fn = String(name || "").trim();
      if (!fn) return errResult({ message: "INVALID_RPC_NAME" }, null);

      const leaderIdRaw =
        String((params as any)?._leader_id || (params as any)?.leader_id || "").trim() || null;
      let scopedIds: string[] | null = null;
      if (leaderIdRaw) {
        scopedIds = await fetchLeaderTreeIds(leaderIdRaw);
        if (!scopedIds.length) scopedIds = ["__none__"];
      }

      if (fn === "report_student_status_counts") {
        const whereParts: string[] = ["role in ('student','trader','coach')"];
        const whereParams: unknown[] = [];
        if (scopedIds) {
          const scopedFilter = buildSqlInFilter("id", scopedIds);
          if (scopedFilter.sql) {
            whereParts.push(scopedFilter.sql);
            whereParams.push(...scopedFilter.params);
          }
        }

        const rows = await dbAll(
          `select
             coalesce(student_status, '\u666e\u901a\u5b66\u5458') as student_status,
             count(*) as total,
             sum(case when status = 'frozen' then 1 else 0 end) as frozen
           from profiles
           where ${whereParts.join(" and ")}
           group by coalesce(student_status, '\u666e\u901a\u5b66\u5458')
           order by total desc`,
          whereParams
        );
        return okResult(rows);
      }

      if (fn === "report_course_access_status_counts") {
        let sql = `select ca.status as status, count(*) as total from course_access ca`;
        const paramsOut: unknown[] = [];
        const whereParts: string[] = [];
        if (scopedIds) {
          const scopedFilter = buildSqlInFilter("ca.user_id", scopedIds);
          if (scopedFilter.sql) {
            whereParts.push(scopedFilter.sql);
            paramsOut.push(...scopedFilter.params);
          }
        }
        if (whereParts.length) sql += ` where ${whereParts.join(" and ")}`;
        sql += " group by ca.status";
        const rows = await dbAll(sql, paramsOut);
        return okResult(rows);
      }

      if (fn === "report_pending_file_access_requests") {
        let sql = `select count(*) as total from file_access_requests where status = 'requested'`;
        const paramsOut: unknown[] = [];
        if (scopedIds) {
          const scopedFilter = buildSqlInFilter("user_id", scopedIds);
          if (scopedFilter.sql) {
            sql += ` and ${scopedFilter.sql}`;
            paramsOut.push(...scopedFilter.params);
          }
        }
        const row = await dbFirst<{ total: number }>(sql, paramsOut);
        return okResult([{ total: Number(row?.total || 0) }]);
      }

      return errResult({ message: `UNSUPPORTED_RPC:${fn}` }, null);
    } catch (error) {
      return errResult(error, null);
    }
  }
}

export type D1DbLikeClient = D1DbClient;

export function createD1DbClient(options?: { currentUserId?: string | null }) {
  return new D1DbClient(options?.currentUserId || null);
}

