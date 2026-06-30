import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

type D1Database = any;

export type D1Row = Record<string, unknown>;
const g = globalThis as {
  __fx_d1_binding?: D1Database | null;
  __fx_d1_binding_promise?: Promise<D1Database> | null;
};
if (!("__fx_d1_binding" in g)) g.__fx_d1_binding = null;
if (!("__fx_d1_binding_promise" in g)) g.__fx_d1_binding_promise = null;

const DB_BUSY_MAX_ATTEMPTS = 4;
const DB_BUSY_BASE_DELAY_MS = 40;
const JSON_EACH_IN_THRESHOLD = 50;

export async function getD1() {
  if (g.__fx_d1_binding) return g.__fx_d1_binding as D1Database;
  if (g.__fx_d1_binding_promise) return g.__fx_d1_binding_promise;

  const task = (async () => {
    const ctx = await getCloudflareContext({ async: true });
    const db = (ctx?.env as any)?.DB;
    if (!db) throw new Error("D1_NOT_CONFIGURED");
    g.__fx_d1_binding = db as D1Database;
    return g.__fx_d1_binding as D1Database;
  })().finally(() => {
    g.__fx_d1_binding_promise = null;
  });

  g.__fx_d1_binding_promise = task;
  return task;
}

function isDbBusyError(error: unknown) {
  const text = `${String((error as any)?.code || "")} ${String((error as any)?.message || "")}`.toLowerCase();
  return (
    text.includes("sqlite_busy") ||
    text.includes("database is locked") ||
    text.includes("database is busy") ||
    text.includes("d1_error")
  );
}

function wait(ms: number) {
  if (!ms) return Promise.resolve();
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withDbBusyRetry<T>(runner: () => Promise<T>) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < DB_BUSY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await runner();
    } catch (error) {
      lastError = error;
      if (!isDbBusyError(error) || attempt >= DB_BUSY_MAX_ATTEMPTS - 1) throw error;
      await wait(DB_BUSY_BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 35));
    }
  }
  throw lastError;
}

export async function dbAll<T extends D1Row = D1Row>(sql: string, params: unknown[] = []) {
  const db = await getD1();
  const res: any = await withDbBusyRetry(() => db.prepare(sql).bind(...params).all());
  return (res?.results || []) as T[];
}

export async function dbFirst<T extends D1Row = D1Row>(sql: string, params: unknown[] = []) {
  const db = await getD1();
  const res: any = await withDbBusyRetry(() => db.prepare(sql).bind(...params).first());
  return (res || null) as T | null;
}

export async function dbRun(sql: string, params: unknown[] = []) {
  const db = await getD1();
  return withDbBusyRetry(() => db.prepare(sql).bind(...params).run());
}

export async function dbBatch(statements: Array<{ sql: string; params?: unknown[] }>) {
  const db = await getD1();
  const prepared = statements.map((s) => db.prepare(s.sql).bind(...(s.params || [])));
  return withDbBusyRetry(() => db.batch(prepared));
}

export function sqlPlaceholders(count: number) {
  return Array.from({ length: Math.max(0, count) }, () => "?").join(", ");
}

function normalizeSqlParam(value: unknown) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function buildSqlInFilter(expression: string, values: readonly unknown[] | null | undefined) {
  const list = Array.isArray(values) ? Array.from(values).map((value) => normalizeSqlParam(value)) : [];
  if (!list.length) return { sql: "", params: [] as unknown[] };
  if (list.length > JSON_EACH_IN_THRESHOLD) {
    return {
      sql: `${expression} in (select value from json_each(?))`,
      params: [JSON.stringify(list)]
    };
  }
  return {
    sql: `${expression} in (${sqlPlaceholders(list.length)})`,
    params: list
  };
}
