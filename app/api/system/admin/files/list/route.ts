import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" }
  });
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }

  const admin = dbAdmin();
  const { data, error, count } = await admin
    .from("files")
    .select("id,category,name,description,storage_bucket,storage_path,size_bytes,mime_type,created_at,uploaded_by", {
      count: "exact"
    })
    .is("course_id", null)
    .is("lesson_id", null)
    .order("created_at", { ascending: false });

  if (error) return json({ ok: false, error: "DB_ERROR" }, 500);
  return json({ ok: true, items: data || [], total: count ?? (data || []).length });
}
