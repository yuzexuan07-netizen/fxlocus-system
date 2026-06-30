import { NextRequest, NextResponse } from "next/server";

import { requireManager } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { mapSystemApiError } from "@/lib/system/apiError";
import { isMissingSchemaError, toSchemaWarning } from "@/lib/system/schema";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { getPagination } from "@/lib/system/pagination";
import { STUDENT_STATUS_VALUES } from "@/lib/system/studentStatusValues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

const PROFILE_SELECT_CANDIDATES = [
  "id,full_name,email,phone,role,status,created_at,last_login_at,student_status,leader_id,source,created_by",
  "id,full_name,email,phone,role,status,created_at,last_login_at,student_status,leader_id,source",
  "id,full_name,email,phone,role,status,created_at,last_login_at,student_status,leader_id,created_by",
  "id,full_name,email,phone,role,status,created_at,last_login_at,student_status,leader_id"
] as const;

const ORDER_COLUMN_CANDIDATES = ["created_at", "id"] as const;
const LEARNER_ROLES = ["student", "trader", "coach", "assistant", "leader"] as const;
const FILTERABLE_STATUS = ["active", "frozen"] as const;

function buildKeywordOrClause(columns: string, keyword: string) {
  if (!keyword) return "";
  const encoded = encodeURIComponent(`%${keyword}%`);
  const clauses: string[] = [];
  if (columns.includes("full_name")) clauses.push(`full_name.ilike.${encoded}`);
  if (columns.includes("email")) clauses.push(`email.ilike.${encoded}`);
  if (columns.includes("phone")) clauses.push(`phone.ilike.${encoded}`);
  return clauses.join(",");
}

function intersectIds(left: string[], right: string[]) {
  if (!left.length || !right.length) return [] as string[];
  const rightSet = new Set(right);
  return left.filter((id) => rightSet.has(id));
}

async function selectProfileRows(
  db: any,
  ids: string[],
  columnCandidates: readonly string[]
) {
  let lastSchemaError: any = null;
  for (const columns of columnCandidates) {
    const result = await selectInBatches<any>({
      db,
      table: "profiles",
      columns,
      key: "id",
      ids
    });
    if (!result.error) {
      return { ...result, selectedColumns: columns };
    }
    if (!isMissingSchemaError(result.error)) {
      return { ...result, selectedColumns: columns };
    }
    lastSchemaError = result.error;
  }
  return {
    data: [] as any[],
    error: lastSchemaError,
    selectedColumns: ""
  };
}

async function selectInBatches<T>({
  db,
  table,
  columns,
  key,
  ids,
  batchSize = 80
}: {
  db: any;
  table: string;
  columns: string;
  key: string;
  ids: string[];
  batchSize?: number;
}): Promise<{ data: T[]; error: any | null }> {
  if (!ids.length) return { data: [], error: null };

  const out: T[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    const { data, error } = await db.from(table).select(columns).in(key, slice);
    if (error) return { data: [], error };
    if (Array.isArray(data)) out.push(...(data as T[]));
  }
  return { data: out, error: null };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireManager();
    if (ctx.user.role === "coach") {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }
    const params = req.nextUrl.searchParams;
    const queryKeyword = String(params.get("q") || "").trim().slice(0, 120);
    const rawStatus = String(params.get("status") || "").trim();
    const statusFilter = FILTERABLE_STATUS.includes(rawStatus as (typeof FILTERABLE_STATUS)[number])
      ? rawStatus
      : "";
    const rawRole = String(params.get("role") || "").trim();
    const roleFilter = LEARNER_ROLES.includes(rawRole as (typeof LEARNER_ROLES)[number]) ? rawRole : "";
    const rawStudentStatus = String(params.get("studentStatus") || "").trim();
    const studentStatusFilter = (STUDENT_STATUS_VALUES as readonly string[]).includes(rawStudentStatus)
      ? rawStudentStatus
      : "";
    const rawSource = String(params.get("source") || "").trim();
    const sourceFilter = rawSource && rawSource !== "all" ? rawSource : "";
    const coachIdFilter = String(params.get("coachId") || "").trim();

    const admin = dbAdmin();
    const db = ctx.user.role === "assistant" ? admin : ctx.db;
    const { page, pageSize, from, to } = getPagination(req, {
      defaultPageSize: 50,
      maxPageSize: 200
    });
    let scopedUserIds: string[] | null = null;
    if (ctx.user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(ctx.user.id);
      if (!treeIds.length) return json({ ok: true, items: [], page, pageSize, total: 0 });
      scopedUserIds = treeIds;
    }

    if (coachIdFilter) {
      const { data: coachScopeRows, error: coachScopeErr } = await db
        .from("coach_assignments")
        .select("assigned_user_id")
        .eq("coach_id", coachIdFilter);
      if (coachScopeErr) {
        if (isMissingSchemaError(coachScopeErr)) {
          return json({
            ok: true,
            items: [],
            page,
            pageSize,
            total: 0,
            schemaWarning: toSchemaWarning(coachScopeErr)
          });
        }
        console.error("[students/list] coach filter query failed:", coachScopeErr);
        return json({ ok: false, error: "DB_ERROR" }, 500);
      }
      const coachScopedUserIds = Array.from(
        new Set((coachScopeRows || []).map((row: any) => String(row.assigned_user_id || "")).filter(Boolean))
      );
      if (!coachScopedUserIds.length) {
        return json({ ok: true, items: [], page, pageSize, total: 0 });
      }
      scopedUserIds = scopedUserIds ? intersectIds(scopedUserIds, coachScopedUserIds) : coachScopedUserIds;
      if (!scopedUserIds.length) {
        return json({ ok: true, items: [], page, pageSize, total: 0 });
      }
    }

    let users: any[] = [];
    let count = 0;
    let error: any = null;
    let selectedColumns = "";
    const profileColumns = sourceFilter
      ? PROFILE_SELECT_CANDIDATES.filter((columns) => columns.includes("source"))
      : PROFILE_SELECT_CANDIDATES;

    for (const columns of profileColumns) {
      for (const orderColumn of ORDER_COLUMN_CANDIDATES) {
        let query = db
          .from("profiles")
          .select(columns, { count: "exact" })
          .in("role", LEARNER_ROLES)
          .order(orderColumn, { ascending: false })
          .range(from, to);

        if (scopedUserIds) query = query.in("id", scopedUserIds);
        if (statusFilter) query = query.eq("status", statusFilter);
        if (studentStatusFilter) query = query.eq("student_status", studentStatusFilter);
        if (roleFilter) query = query.eq("role", roleFilter);
        if (sourceFilter) query = query.eq("source", sourceFilter);
        if (queryKeyword) {
          const clause = buildKeywordOrClause(columns, queryKeyword);
          if (!clause) continue;
          query = query.or(clause);
        }

        if (ctx.user.role === "assistant") {
          if (columns.includes("created_by")) {
            query = query.eq("created_by", ctx.user.id);
          } else {
            // 缺少 created_by 列时，降级为仅显示自己，避免数据越权
            query = query.eq("id", ctx.user.id);
          }
        }

        const result = await query;
        if (result.error) {
          if (isMissingSchemaError(result.error)) {
            error = result.error;
            continue;
          }
          error = result.error;
          break;
        }

        users = Array.isArray(result.data) ? result.data : [];
        count = Number(result.count || users.length);
        selectedColumns = columns;
        error = null;
        break;
      }
      if (!error && selectedColumns) break;
      if (error && !isMissingSchemaError(error)) break;
    }

    if (error) {
      if (isMissingSchemaError(error)) {
        return json({
          ok: true,
          items: [],
          page,
          pageSize,
          total: 0,
          schemaWarning: toSchemaWarning(error)
        });
      }
      console.error("[students/list] profiles query failed:", error);
      return json({ ok: false, error: "DB_ERROR" }, 500);
    }

    if (selectedColumns && !selectedColumns.includes("created_by")) {
      users = users.map((item: any) => ({ ...item, created_by: null }));
    }
    if (selectedColumns && !selectedColumns.includes("source")) {
      users = users.map((item: any) => ({ ...item, source: null }));
    }
    const beforeSelfFilterCount = users.length;
    users = users.filter((item: any) => String(item?.id || "") !== ctx.user.id);
    const removedSelfCount = beforeSelfFilterCount - users.length;
    if (removedSelfCount > 0) {
      count = Math.max(0, Number(count || 0) - removedSelfCount);
    }

    const userIds = (users || []).map((u: any) => u.id);
    const leaderIds = Array.from(
      new Set((users || []).map((u: any) => u.leader_id).filter(Boolean))
    ) as string[];
    const createdByIds = Array.from(
      new Set((users || []).map((u: any) => u.created_by).filter(Boolean))
    ) as string[];
    const { data: leaders, error: leaderErr, selectedColumns: leaderColumns } = await selectProfileRows(db, leaderIds, [
      "id,full_name,email",
      "id,email",
      "id"
    ]);

    if (leaderErr) {
      if (isMissingSchemaError(leaderErr)) {
        console.warn("[students/list] leaders schema mismatch:", leaderErr);
      } else {
        console.error("[students/list] leaders query failed:", leaderErr);
        return json({ ok: false, error: "DB_ERROR" }, 500);
      }
    }
    const normalizedLeaders = (leaders || []).map((row: any) => ({
      ...row,
      full_name: leaderColumns.includes("full_name") ? row.full_name ?? null : null,
      email: leaderColumns.includes("email") ? row.email ?? null : null
    }));
    const { data: creators, error: creatorErr, selectedColumns: creatorColumns } = await selectProfileRows(
      db,
      createdByIds,
      ["id,full_name,email,role,status", "id,email,role,status", "id,role,status", "id"]
    );
    if (creatorErr) {
      if (isMissingSchemaError(creatorErr)) {
        console.warn("[students/list] creators schema mismatch:", creatorErr);
      } else {
        console.error("[students/list] creators query failed:", creatorErr);
        return json({ ok: false, error: "DB_ERROR" }, 500);
      }
    }
    const normalizedCreators = (creators || []).map((row: any) => ({
      ...row,
      full_name: creatorColumns.includes("full_name") ? row.full_name ?? null : null,
      email: creatorColumns.includes("email") ? row.email ?? null : null,
      role: creatorColumns.includes("role") ? row.role ?? null : null,
      status: creatorColumns.includes("status") ? row.status ?? null : null
    }));
    let access: any[] = [];
    const { data: rawAccess, error: accessErr } = await selectInBatches<any>({
      db,
      table: "course_access",
      columns: "user_id,status",
      key: "user_id",
      ids: userIds
    });
    if (accessErr) {
      if (!isMissingSchemaError(accessErr)) {
        console.error("[students/list] course_access query failed:", accessErr);
        return json({ ok: false, error: "DB_ERROR" }, 500);
      }
    } else {
      access = rawAccess || [];
    }

    let { data: coachAssignments, error: coachErr } = await selectInBatches<any>({
      db,
      table: "coach_assignments",
      columns: "assigned_user_id,coach_id",
      key: "assigned_user_id",
      ids: userIds
    });

    if (coachErr) {
      if (isMissingSchemaError(coachErr)) {
        coachAssignments = [];
      } else {
        console.error("[students/list] coach_assignments query failed:", coachErr);
        return json({ ok: false, error: "DB_ERROR" }, 500);
      }
    }

    const coachIds = Array.from(
      new Set((coachAssignments || []).map((row: any) => String(row.coach_id || "")).filter(Boolean))
    );
    const { data: coaches, error: coachProfileErr, selectedColumns: coachColumns } = await selectProfileRows(
      db,
      coachIds,
      ["id,full_name,email", "id,email", "id"]
    );
    if (coachProfileErr) {
      if (!isMissingSchemaError(coachProfileErr)) {
        console.error("[students/list] coach profile query failed:", coachProfileErr);
        return json({ ok: false, error: "DB_ERROR" }, 500);
      }
    }
    const normalizedCoaches = (coaches || []).map((row: any) => ({
      ...row,
      full_name: coachColumns.includes("full_name") ? row.full_name ?? null : null,
      email: coachColumns.includes("email") ? row.email ?? null : null
    }));
    const coachById = new Map((normalizedCoaches || []).map((row: any) => [String(row.id || ""), row]));

    const statsByUser = new Map<
      string,
      { requested: number; approved: number; completed: number; rejected: number }
    >();
    (access || []).forEach((row: any) => {
      const s = statsByUser.get(row.user_id) || {
        requested: 0,
        approved: 0,
        completed: 0,
        rejected: 0
      };
      if (row.status === "requested") s.requested += 1;
      if (row.status === "approved") s.approved += 1;
      if (row.status === "completed") s.completed += 1;
      if (row.status === "rejected") s.rejected += 1;
      statsByUser.set(row.user_id, s);
    });

    const leadersById = new Map((normalizedLeaders || []).map((l: any) => [l.id, l]));
    const creatorsById = new Map((normalizedCreators || []).map((c: any) => [c.id, c]));
    const coachByUserId = new Map<
      string,
      { coach_id: string | null; coach: any | null }
    >(
      (coachAssignments || []).map((row: any) => [
        row.assigned_user_id,
        {
          coach_id: row.coach_id || null,
          coach: row.coach_id ? coachById.get(String(row.coach_id)) || null : null
        }
      ])
    );

    const items = (users || []).map((u: any) => ({
      ...u,
      last_login_at: u.last_login_at || null,
      full_name: u.full_name || "",
      leader: u.leader_id ? leadersById.get(u.leader_id) || null : null,
      assistant: u.created_by ? creatorsById.get(u.created_by) || null : null,
      coach: coachByUserId.get(u.id)?.coach || null,
      coach_id: coachByUserId.get(u.id)?.coach_id || null,
      stats: statsByUser.get(u.id) || { requested: 0, approved: 0, completed: 0, rejected: 0 }
    }));

    return json({ ok: true, items, page, pageSize, total: count ?? items.length });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}


