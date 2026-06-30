import { NextResponse } from "next/server";

import { dbAll } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { requireSystemUser } from "@/lib/system/guard";
import { isMissingSchemaError } from "@/lib/system/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" }
  });
}

export async function GET() {
  try {
    const { user } = await requireSystemUser();
    const rows = await dbAll(
      "select course_id, status, rejection_reason, progress, updated_at from course_access where user_id = ?",
      [user.id]
    );
    const groupRows = await dbAll(
      "select course_type, status, rejection_reason, updated_at from course_group_access where user_id = ?",
      [user.id]
    ).catch((error) => {
      if (!isMissingSchemaError(error)) throw error;
      return [];
    });
    const items = (rows || []).map((row: any) => ({
      course_id: Number(row.course_id),
      status: String(row.status || "requested"),
      rejection_reason: row.rejection_reason ?? null,
      progress: row.progress ?? null,
      updated_at: row.updated_at ?? null
    }));
    const groupAccess = (groupRows || []).map((row: any) => ({
      course_type: String(row.course_type || ""),
      status: String(row.status || ""),
      rejection_reason: row.rejection_reason ?? null,
      updated_at: row.updated_at ?? null
    }));
    return json({ ok: true, items, groupAccess });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
