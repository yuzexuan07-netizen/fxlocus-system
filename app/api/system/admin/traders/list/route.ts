import { NextRequest, NextResponse } from "next/server";

import { mapSystemApiError } from "@/lib/system/apiError";
import { requireSuperAdmin } from "@/lib/system/guard";
import { getPagination } from "@/lib/system/pagination";
import { isMissingSchemaError, toSchemaWarning } from "@/lib/system/schema";
import {
  getPassedDonationStatusCandidates,
  normalizeStudentStatus
} from "@/lib/system/studentStatusValues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" }
  });
}

const TRADER_SELECT_CANDIDATES = [
  "id,full_name,email,phone,status,student_status,created_at,last_login_at,leader_id,role",
  "id,full_name,email,phone,status,student_status,created_at,leader_id,role",
  "id,full_name,email,phone,status,student_status,leader_id,role",
  "id,email,status,student_status,leader_id,role"
] as const;

const TRADER_ORDER_CANDIDATES = ["created_at", "id"] as const;
const LEADER_SELECT_CANDIDATES = ["id,full_name,email", "id,email", "id"] as const;

export async function GET(req: NextRequest) {
  try {
    const { db } = await requireSuperAdmin();
    const { page, pageSize, from, to } = getPagination(req, { defaultPageSize: 50, maxPageSize: 200 });
    const passedDonationValues = getPassedDonationStatusCandidates().map((value) => encodeURIComponent(value));
    const passedDonationFilter = `student_status.in.(${passedDonationValues.join(",")})`;

    let selectedColumns = "";
    let rows: any[] = [];
    let total = 0;
    let queryError: any = null;

    for (const columns of TRADER_SELECT_CANDIDATES) {
      for (const orderColumn of TRADER_ORDER_CANDIDATES) {
        let query = db
          .from("profiles")
          .select(columns, { count: "exact" })
          .order(orderColumn, { ascending: false })
          .range(from, to);
        if (columns.includes("role")) {
          query = query
            .in("role", ["student", "trader", "coach", "assistant", "leader"])
            .or(`role.eq.trader,${passedDonationFilter}`);
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
        rows = Array.isArray(result.data) ? result.data : [];
        total = Number(result.count || rows.length);
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
      new Set((rows || []).map((row: any) => String(row.leader_id || "")).filter(Boolean))
    ) as string[];

    let leaders: any[] = [];
    if (leaderIds.length) {
      let leaderErr: any = null;
      for (const columns of LEADER_SELECT_CANDIDATES) {
        const result = await db.from("profiles").select(columns).in("id", leaderIds);
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

    const items = (rows || []).map((row: any) => ({
      ...row,
      full_name: selectedColumns.includes("full_name") ? row.full_name || null : null,
      email: selectedColumns.includes("email") ? row.email || null : null,
      phone: selectedColumns.includes("phone") ? row.phone || null : null,
      status: selectedColumns.includes("status") ? row.status || "active" : "active",
      student_status: normalizeStudentStatus(row.student_status),
      created_at: selectedColumns.includes("created_at") ? row.created_at || null : null,
      last_login_at: selectedColumns.includes("last_login_at") ? row.last_login_at || null : null,
      leader: row.leader_id ? leaderById.get(row.leader_id) || null : null
    }));

    return json({ ok: true, items, page, pageSize, total: total ?? items.length });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
