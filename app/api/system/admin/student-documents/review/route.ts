import { NextRequest, NextResponse } from "next/server";

import { requireManager } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { mapSystemApiError } from "@/lib/system/apiError";
import { invalidateSidebarCountsCache, invalidateStudentDocumentsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireManager();
    const body = await req.json().catch(() => ({}));
    const studentId = String(body?.student_id || body?.studentId || "").trim();
    if (!studentId) return json({ ok: false, error: "MISSING_STUDENT_ID" }, 400);

    const admin = dbAdmin();
    let scopedIds: string[] | null = null;
    if (user.role === "leader") {
      scopedIds = await fetchLeaderTreeIds(user.id);
    } else if (user.role === "coach") {
      scopedIds = await fetchCoachAssignedUserIds(user.id);
    } else if (user.role === "assistant") {
      scopedIds = await fetchAssistantCreatedUserIds(user.id);
    } else if (user.role === "super_admin") {
      scopedIds = null;
    }

    if (scopedIds && !scopedIds.includes(studentId)) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const { error } = await admin
      .from("student_documents")
      .update({ reviewed_at: new Date().toISOString(), reviewed_by: user.id })
      .eq("student_id", studentId);
    if (error) return json({ ok: false, error: error.message }, 500);

    invalidateStudentDocumentsCache();
    invalidateSidebarCountsCache();

    return json({ ok: true });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}



