import { NextRequest, NextResponse } from "next/server";

import { mapSystemApiError } from "@/lib/system/apiError";
import { requireSuperAdmin } from "@/lib/system/guard";
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

const LEADER_SELECT_CANDIDATES = [
  "id,email,full_name,phone,role,status,created_at,last_login_at",
  "id,email,full_name,phone,role,status,created_at",
  "id,email,full_name,role,status",
  "id,email,role,status"
] as const;

const LEADER_ORDER_CANDIDATES = ["created_at", "id"] as const;

export async function GET(req: NextRequest) {
  try {
    const { db } = await requireSuperAdmin();
    const { page, pageSize, from, to } = getPagination(req, { defaultPageSize: 50, maxPageSize: 200 });

    let selectedColumns = "";
    let items: any[] = [];
    let total = 0;
    let queryError: any = null;

    for (const columns of LEADER_SELECT_CANDIDATES) {
      for (const orderColumn of LEADER_ORDER_CANDIDATES) {
        const result = await db
          .from("profiles")
          .select(columns, { count: "exact" })
          .eq("role", "leader")
          .order(orderColumn, { ascending: false })
          .range(from, to);

        if (result.error) {
          if (isMissingSchemaError(result.error)) {
            queryError = result.error;
            continue;
          }
          queryError = result.error;
          break;
        }

        selectedColumns = columns;
        items = Array.isArray(result.data) ? result.data : [];
        total = Number(result.count || items.length);
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

    const normalizedItems = (items || []).map((row: any) => ({
      ...row,
      full_name: selectedColumns.includes("full_name") ? row.full_name || null : null,
      email: selectedColumns.includes("email") ? row.email || null : null,
      phone: selectedColumns.includes("phone") ? row.phone || null : null,
      role: selectedColumns.includes("role") ? row.role || "leader" : "leader",
      status: selectedColumns.includes("status") ? row.status || "active" : "active",
      created_at: selectedColumns.includes("created_at") ? row.created_at || null : null,
      last_login_at: selectedColumns.includes("last_login_at") ? row.last_login_at || null : null
    }));

    return json({ ok: true, items: normalizedItems, page, pageSize, total: total || normalizedItems.length });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}

