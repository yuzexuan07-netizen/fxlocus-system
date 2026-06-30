import { NextResponse } from "next/server";

import { requireManager } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { removeStoredObjects } from "@/lib/storage/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user } = await requireManager();

    const body = await req.json().catch(() => null);
    const id = String(body?.id || "").trim();
    const studentId = String(body?.student_id || body?.studentId || "").trim();
    if (!id && !studentId) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const admin = dbAdmin();
    let targetStudentId = studentId;
    let docs: { id: string; student_id: string; storage_bucket: string | null; storage_path: string | null }[] = [];

    if (!targetStudentId) {
      const { data: doc, error: docErr } = await admin
        .from("student_documents")
        .select("id,student_id,storage_bucket,storage_path")
        .eq("id", id)
        .maybeSingle();
      if (docErr) return json({ ok: false, error: docErr.message }, 500);
      if (!doc?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
      targetStudentId = doc.student_id;
      docs = [doc];
    }

    if (!targetStudentId) return json({ ok: false, error: "NOT_FOUND" }, 404);

    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      if (!treeIds.includes(targetStudentId)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    } else if (user.role === "assistant") {
      const createdIds = await fetchAssistantCreatedUserIds(user.id);
      if (!createdIds.includes(targetStudentId)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    } else if (user.role !== "super_admin") {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    if (studentId) {
      const { data: docRows, error: docsErr } = await admin
        .from("student_documents")
        .select("id,student_id,storage_bucket,storage_path")
        .eq("student_id", targetStudentId);
      if (docsErr) return json({ ok: false, error: docsErr.message }, 500);
      docs = docRows || [];
    }

    const stored = docs
      .filter((doc) => doc.storage_bucket && doc.storage_path)
      .map((doc) => ({ bucket: doc.storage_bucket as string, path: doc.storage_path as string }));
    if (stored.length) {
      await removeStoredObjects(admin, stored);
    }

    const deleteQuery = studentId
      ? admin.from("student_documents").delete().eq("student_id", targetStudentId)
      : admin.from("student_documents").delete().eq("id", id);

    const { error: delErr } = await deleteQuery;
    if (delErr) return json({ ok: false, error: delErr.message }, 500);

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}


