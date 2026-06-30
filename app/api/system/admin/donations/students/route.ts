import { NextResponse } from "next/server";

import { mapSystemApiError } from "@/lib/system/apiError";
import { requireSuperAdmin } from "@/lib/system/guard";
import { isMissingSchemaError, toSchemaWarning } from "@/lib/system/schema";
import {
  isDonationStudentStatus,
  normalizeStudentStatus,
  STUDENT_STATUS_DONATION,
  STUDENT_STATUS_PASSED_DONATION
} from "@/lib/system/studentStatusValues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

const DONATION_STATUS_SET = new Set([STUDENT_STATUS_DONATION, STUDENT_STATUS_PASSED_DONATION]);
const ALLOWED_ROLES = new Set(["student", "trader", "coach", "assistant", "leader"]);

const PROFILE_SELECT_CANDIDATES = [
  "id,full_name,email,phone,leader_id,student_status,created_at,last_login_at,role",
  "id,full_name,email,phone,leader_id,student_status,created_at,last_login_at",
  "id,full_name,email,phone,leader_id,student_status,last_login_at",
  "id,email,leader_id,student_status"
] as const;

const ORDER_COLUMN_CANDIDATES = ["created_at", "id"] as const;
const LEADER_SELECT_CANDIDATES = ["id,full_name,email", "id,email", "id"] as const;

export async function GET() {
  try {
    const { db } = await requireSuperAdmin();

    let selectedColumns = "";
    let profileRows: any[] = [];
    let queryError: any = null;

    for (const columns of PROFILE_SELECT_CANDIDATES) {
      for (const orderColumn of ORDER_COLUMN_CANDIDATES) {
        let query = db.from("profiles").select(columns).order(orderColumn, { ascending: false }).limit(5000);
        if (columns.includes("role")) {
          query = query.in("role", Array.from(ALLOWED_ROLES));
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
        profileRows = Array.isArray(result.data) ? result.data : [];
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
          schemaWarning: toSchemaWarning(queryError)
        });
      }
      return json({ ok: false, error: "DB_ERROR" }, 500);
    }

    const rows = (profileRows || [])
      .filter((row: any) => {
        if (!selectedColumns.includes("role")) return true;
        return ALLOWED_ROLES.has(String(row.role || ""));
      })
      .map((row: any) => ({
        ...row,
        student_status: normalizeStudentStatus(row.student_status)
      }))
      .filter((row: any) => isDonationStudentStatus(row.student_status));

    const leaderIds = Array.from(
      new Set(rows.map((row: any) => String(row.leader_id || "")).filter(Boolean))
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
    const leadersById = new Map((leaders || []).map((leader: any) => [String(leader.id), leader]));

    const items = rows.map((row: any) => ({
      ...row,
      full_name: selectedColumns.includes("full_name") ? row.full_name || null : null,
      email: selectedColumns.includes("email") ? row.email || null : null,
      phone: selectedColumns.includes("phone") ? row.phone || null : null,
      created_at: selectedColumns.includes("created_at") ? row.created_at || null : null,
      last_login_at: selectedColumns.includes("last_login_at") ? row.last_login_at || null : null,
      role: selectedColumns.includes("role") ? row.role || "student" : "student",
      leader: row.leader_id ? leadersById.get(String(row.leader_id)) || null : null
    }));

    return json({ ok: true, items, statuses: Array.from(DONATION_STATUS_SET) });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
