import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { dbAll, dbFirst } from "@/lib/d1";
import { requireAdmin } from "@/lib/system/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 8_000;
const CACHE_MAX_KEYS = 2_000;

type AssistantStudentsPayload = {
  ok: true;
  items: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
};

const AssistantIdParam = z.string().trim().min(1).max(128);
const g = globalThis as {
  __fx_admin_assistant_students_cache?: Map<string, { exp: number; payload: AssistantStudentsPayload }>;
  __fx_admin_assistant_students_inflight?: Map<string, Promise<AssistantStudentsPayload>>;
};
if (!g.__fx_admin_assistant_students_cache) g.__fx_admin_assistant_students_cache = new Map();
if (!g.__fx_admin_assistant_students_inflight) g.__fx_admin_assistant_students_inflight = new Map();
const assistantStudentsCache = g.__fx_admin_assistant_students_cache;
const assistantStudentsInflight = g.__fx_admin_assistant_students_inflight;

const STUDENT_SELECT_CANDIDATES = [
  "id,full_name,email,phone,role,status,student_status,last_login_at,created_at",
  "id,full_name,email,phone,role,status,null as student_status,last_login_at,null as created_at",
  "id,full_name,email,phone,role,status,null as student_status,null as last_login_at,null as created_at",
  "id,email,null as full_name,null as phone,role,status,null as student_status,null as last_login_at,null as created_at"
] as const;

const ORDER_CANDIDATES = ["created_at", "id"] as const;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" }
  });
}

function sweepAssistantStudentsCache(now: number) {
  if (!assistantStudentsCache.size) return;
  for (const [key, value] of assistantStudentsCache.entries()) {
    if (value.exp <= now) assistantStudentsCache.delete(key);
  }
  if (assistantStudentsCache.size <= CACHE_MAX_KEYS) return;
  const overflow = assistantStudentsCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of assistantStudentsCache.keys()) {
    assistantStudentsCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function isMissingColumnError(error: unknown) {
  return /no such column/i.test(String((error as any)?.message || ""));
}

function normalizeRole(raw: unknown): "student" | "trader" | "coach" {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "trader") return "trader";
  if (value === "coach") return "coach";
  return "student";
}

function normalizeStatus(raw: unknown): "active" | "frozen" {
  return String(raw || "").trim().toLowerCase() === "frozen" ? "frozen" : "active";
}

function getPagination(req: NextRequest, defaultPageSize = 20, maxPageSize = 200) {
  const pageRaw = Number(req.nextUrl.searchParams.get("page") || "1");
  const pageSizeRaw = Number(req.nextUrl.searchParams.get("pageSize") || String(defaultPageSize));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.max(1, Math.min(maxPageSize, Math.floor(pageSizeRaw)))
    : defaultPageSize;
  const from = (page - 1) * pageSize;
  return { page, pageSize, from };
}

export async function GET(
  req: NextRequest,
  context: { params: { assistantId: string } }
) {
  try {
    const { user } = await requireAdmin();
    const assistantIdRaw = String(context?.params?.assistantId || "").trim();
    const parsedAssistantId = AssistantIdParam.safeParse(assistantIdRaw);
    if (!parsedAssistantId.success) return json({ ok: false, error: "INVALID_ASSISTANT" }, 400);
    const assistantId = parsedAssistantId.data;

    const assistant = await dbFirst<{ id: string; role: string; leader_id: string | null }>(
      "select id, role, leader_id from profiles where id = ? limit 1",
      [assistantId]
    );
    if (!assistant?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
    if (String(assistant.role || "").trim().toLowerCase() !== "assistant") {
      return json({ ok: false, error: "NOT_ASSISTANT" }, 400);
    }
    if (user.role === "leader" && String(assistant.leader_id || "") !== user.id) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const { page, pageSize, from } = getPagination(req, 20, 200);
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const cacheKey = `${user.id}:${user.role}:${assistantId}:${page}:${pageSize}:${from}`;

    if (!fresh) {
      const now = Date.now();
      sweepAssistantStudentsCache(now);
      const cached = assistantStudentsCache.get(cacheKey);
      if (cached && cached.exp > now) return json(cached.payload);
    }

    let task = fresh ? undefined : assistantStudentsInflight.get(cacheKey);
    if (!task) {
      task = (async (): Promise<AssistantStudentsPayload> => {
        let rows: any[] = [];
        let selectedColumns = "";
        let queryError: unknown = null;

        for (const columns of STUDENT_SELECT_CANDIDATES) {
          for (const orderColumn of ORDER_CANDIDATES) {
            const sql = [
              `select ${columns}, count(1) over() as __total`,
              "from profiles",
              "where created_by = ? and role in ('student','trader','coach','deleted_student')",
              `order by ${orderColumn} desc`,
              "limit ? offset ?"
            ].join(" ");

            try {
              const result = await dbAll(sql, [assistantId, pageSize, from]);
              rows = Array.isArray(result) ? result : [];
              selectedColumns = columns;
              queryError = null;
              break;
            } catch (error) {
              queryError = error;
              if (isMissingColumnError(error)) continue;
              break;
            }
          }
          if (!queryError && selectedColumns) break;
          if (queryError && !isMissingColumnError(queryError)) break;
        }

        if (queryError) {
          if (isMissingColumnError(queryError)) {
            return { ok: true, items: [], page, pageSize, total: 0 };
          }
          throw queryError;
        }

        let total = Number((rows || [])[0]?.__total || 0);
        if (!(rows || []).length && from > 0) {
          const countRow = await dbFirst<{ total: number }>(
            "select count(1) as total from profiles where created_by = ? and role in ('student','trader','coach','deleted_student')",
            [assistantId]
          );
          total = Number(countRow?.total || 0);
        }
        if (!total) return { ok: true, items: [], page, pageSize, total: 0 };

        const items = (rows || []).map((row: any) => ({
          id: String(row.id || ""),
          full_name: selectedColumns.includes("full_name") ? row.full_name || null : null,
          email: row.email || null,
          phone: selectedColumns.includes("phone") ? row.phone || null : null,
          role: normalizeRole(row.role),
          status: normalizeStatus(row.status),
          student_status: selectedColumns.includes("student_status") ? row.student_status || null : null,
          last_login_at: selectedColumns.includes("last_login_at") ? row.last_login_at || null : null
        }));

        return { ok: true, items, page, pageSize, total };
      })();
      if (!fresh) assistantStudentsInflight.set(cacheKey, task);
    }

    try {
      const payload = await task;
      if (!fresh) {
        assistantStudentsCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
      }
      return json(payload);
    } finally {
      if (!fresh) assistantStudentsInflight.delete(cacheKey);
    }
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
