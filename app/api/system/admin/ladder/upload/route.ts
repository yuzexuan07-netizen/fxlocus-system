import { NextRequest, NextResponse } from "next/server";

import { getSystemAuth } from "@/lib/system/auth";
import { isAdminRole } from "@/lib/system/roles";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { getR2Bucket, r2Enabled } from "@/lib/storage/r2";
import { removeStoredObjects, uploadBufferToStorage } from "@/lib/storage/storage";
import { buildRequestScopedId, buildRequestScopedPath, normalizeRequestId } from "@/lib/system/uploadIdempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "ladder";
}

export async function POST(req: NextRequest) {
  const auth = await getSystemAuth();
  if (!auth.ok) return noStoreJson({ ok: false, error: auth.reason }, 401);
  if (!isAdminRole(auth.user.role)) return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);

  const form = await req.formData().catch(() => null);
  if (!form) return noStoreJson({ ok: false, error: "INVALID_FORM" }, 400);

  const file = form.get("file");
  const requestId = normalizeRequestId(form.get("requestId"));
  if (String(form.get("requestId") || "").trim() && !requestId) {
    return noStoreJson({ ok: false, error: "INVALID_REQUEST" }, 400);
  }
  if (!(file instanceof File)) return noStoreJson({ ok: false, error: "MISSING_FILE" }, 400);

  const admin = dbAdmin();
  const now = new Date().toISOString();
  const datePrefix = now.slice(0, 10);

  const bucket = r2Enabled() ? getR2Bucket() : "fxlocus_ladder";
  const filename = safeFilename(file.name || "ladder.png");
  const path = buildRequestScopedPath(
    `ladder/${datePrefix}`,
    requestId,
    `-${filename}`,
    () => `ladder/${datePrefix}/${Date.now()}-${Math.random().toString(16).slice(2)}-${filename}`
  );

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    await uploadBufferToStorage(admin, bucket, path, bytes, file.type || "image/png");
  } catch {
    return noStoreJson({ ok: false, error: "UPLOAD_FAILED" }, 500);
  }

  const snapshotId = requestId ? buildRequestScopedId("ladder", auth.user.id, requestId) : "";
  const { data: row, error: dbErr } = await admin
    .from("ladder_snapshots")
    .insert({
      ...(snapshotId ? { id: snapshotId } : {}),
      storage_bucket: bucket,
      storage_path: path,
      created_by: auth.user.id,
      captured_at: now
    })
    .select("id")
    .single();

  if (dbErr || !row?.id) {
    if (snapshotId) {
      const existing = await admin.from("ladder_snapshots").select("id").eq("id", snapshotId).maybeSingle();
      if (existing.data?.id) return noStoreJson({ ok: true, id: existing.data.id, duplicated: true });
    }
    await removeStoredObjects(admin, [{ bucket, path }]);
    return noStoreJson({ ok: false, error: "DB_ERROR" }, 500);
  }
  return noStoreJson({ ok: true, id: row.id });
}
