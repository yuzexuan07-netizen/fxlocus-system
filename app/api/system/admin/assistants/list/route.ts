import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/system/guard";
import { mapSystemApiError } from "@/lib/system/apiError";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { getPagination } from "@/lib/system/pagination";
import { isMissingSchemaError, toSchemaWarning } from "@/lib/system/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" }
  });
}

const ASSISTANT_SELECT_CANDIDATES = [
  "id,full_name,email,phone,leader_id,status,created_at,last_login_at,created_by",
  "id,full_name,email,phone,leader_id,status,created_at,last_login_at",
  "id,full_name,email,phone,leader_id,status,last_login_at",
  "id,email,leader_id,status"
] as const;

const ASSISTANT_ORDER_CANDIDATES = ["created_at", "id"] as const;

const LEADER_SELECT_CANDIDATES = ["id,full_name,email", "id,email", "id"] as const;

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAdmin();
    const admin = dbAdmin();
    const { page, pageSize, from, to } = getPagination(req, { defaultPageSize: 50, maxPageSize: 200 });

    let selectedColumns = "";
    let assistants: any[] = [];
    let total = 0;
    let queryError: any = null;

    for (const columns of ASSISTANT_SELECT_CANDIDATES) {
      for (const orderColumn of ASSISTANT_ORDER_CANDIDATES) {
        let query = admin
          .from("profiles")
          .select(columns, { count: "exact" })
          .eq("role", "assistant")
          .order(orderColumn, { ascending: false })
          .range(from, to);

        if (user.role === "leader") {
          query = query.eq("leader_id", user.id);
        }

        const result = await query;
        if (result.error) {
          if (isMissingSchemaError(result.error)) {
            queryError = result.error;
            continue;
          }
          queryError = result.error;
          break;
        }

        selectedColumns = columns;
        assistants = Array.isArray(result.data) ? result.data : [];
        total = Number(result.count || assistants.length);
        queryError = null;
        break;
      }
      if (!queryError && selectedColumns) break;
      if (queryError && !isMissingSchemaError(queryError)) break;
    }

    if (queryError) {
      if (isMissingSchemaError(queryError)) {
        return json({
          ok: true,
          items: [],
          page,
          pageSize,
          total: 0,
          schemaWarning: toSchemaWarning(queryError)
        });
      }
      return json({ ok: false, error: "DB_ERROR" }, 500);
    }

    const leaderIds = Array.from(
      new Set((assistants || []).map((row: any) => String(row.leader_id || "")).filter(Boolean))
    ) as string[];

    let leaders: any[] = [];
    if (leaderIds.length) {
      let leaderErr: any = null;
      for (const columns of LEADER_SELECT_CANDIDATES) {
        const result = await admin.from("profiles").select(columns).in("id", leaderIds);
        if (result.error) {
          if (isMissingSchemaError(result.error)) {
            leaderErr = result.error;
            continue;
          }
          leaderErr = result.error;
          break;
        }
        leaderErr = null;
        leaders = Array.isArray(result.data) ? result.data : [];
        break;
      }
      if (leaderErr && !isMissingSchemaError(leaderErr)) {
        return json({ ok: false, error: "DB_ERROR" }, 500);
      }
    }

    const leaderById = new Map((leaders || []).map((row: any) => [row.id, row]));
    const items = (assistants || []).map((row: any) => ({
      ...row,
      full_name: selectedColumns.includes("full_name") ? row.full_name || null : null,
      email: selectedColumns.includes("email") ? row.email || null : null,
      phone: selectedColumns.includes("phone") ? row.phone || null : null,
      created_at: selectedColumns.includes("created_at") ? row.created_at || null : null,
      last_login_at: selectedColumns.includes("last_login_at") ? row.last_login_at || null : null,
      created_by: selectedColumns.includes("created_by") ? row.created_by || null : null,
      leader: row.leader_id ? leaderById.get(row.leader_id) || null : null
    }));

    return json({ ok: true, items, page, pageSize, total: total ?? items.length });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
