import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { requireLearner } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { getR2Bucket, r2Enabled } from "@/lib/storage/r2";
import { createSignedUploadUrl } from "@/lib/storage/storage";
import { createD1TextId } from "@/lib/system/d1Id";
import { buildRequestScopedId, normalizeRequestId } from "@/lib/system/uploadIdempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx", "png", "jpg", "jpeg"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg"
]);

type PresignFile = {
  name?: string;
  size?: number;
  type?: string;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function safeFilename(name: string) {
  return (name || "upload.bin").replace(/[^\w.\-()+\s]/g, "_").slice(0, 120) || "upload.bin";
}

function isAllowedMeta(name: string, mime: string | null) {
  const lower = String(name || "").toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";
  const safeMime = String(mime || "").toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIME_TYPES.has(safeMime);
}

function hasValidSize(size: number) {
  return Number.isFinite(size) && size > 0;
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireLearner();
    const payload = await req.json().catch(() => null);
    const rawFiles = Array.isArray(payload?.files) ? (payload.files as PresignFile[]) : [];
    if (!rawFiles.length) return json({ ok: false, error: "MISSING_FILES" }, 400);
    if (rawFiles.length > 3) return json({ ok: false, error: "TOO_MANY_FILES" }, 400);

    const replace = payload?.replace === true;
    const submissionIdRaw = typeof payload?.submissionId === "string" ? payload.submissionId.trim() : "";
    const requestId = normalizeRequestId(payload?.requestId);
    if (replace && !submissionIdRaw) return json({ ok: false, error: "INVALID_SUBMISSION" }, 400);
    if (submissionIdRaw.length > 128) {
      return json({ ok: false, error: "INVALID_SUBMISSION" }, 400);
    }

    const admin = dbAdmin();
    const submissionId =
      submissionIdRaw || (requestId ? buildRequestScopedId("tradestrategy", user.id, requestId) : createD1TextId());

    if (replace) {
      const { data: existing, error: existingErr } = await admin
        .from("trade_submissions")
        .select("id,user_id,type,status")
        .eq("id", submissionId)
        .maybeSingle();

      if (existingErr) return json({ ok: false, error: existingErr.message }, 500);
      if (!existing?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
      if (existing.user_id !== user.id || existing.type !== "trade_strategy") {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }
      if (existing.status !== "submitted") {
        return json({ ok: false, error: "ALREADY_REVIEWED" }, 400);
      }
    }

    const bucketCandidates = r2Enabled()
      ? [getR2Bucket()]
      : ([process.env.SYSTEM_FILES_BUCKET, process.env.R2_BUCKET, "fxlocus-system-files"].filter(Boolean) as string[]);
    const uploads: Array<{
      bucket: string;
      path: string;
      token?: string | null;
      uploadUrl?: string | null;
      fileName: string;
      mimeType: string | null;
      size: number;
    }> = [];

    for (let index = 0; index < rawFiles.length; index += 1) {
      const file = rawFiles[index];
      const originalName = String(file.name || "").trim();
      const safeName = safeFilename(originalName);
      const displayName = originalName || safeName;
      const mimeType = file.type ? String(file.type) : null;
      const size = Number(file.size || 0);
      if (!isAllowedMeta(displayName, mimeType)) {
        return json({ ok: false, error: "INVALID_FILE_TYPE" }, 400);
      }
      if (!hasValidSize(size)) {
        return json({ ok: false, error: "EMPTY_FILE" }, 400);
      }

      const path = requestId
        ? `trade-strategies/${user.id}/${submissionId}/${String(index).padStart(2, "0")}-${safeName}`
        : `trade-strategies/${user.id}/${submissionId}/${Date.now()}-${randomUUID()}-${safeName}`;

      const bucketUsed = bucketCandidates[0] || "fxlocus-system-files";
      const signed = await createSignedUploadUrl(
        admin,
        bucketUsed,
        path,
        mimeType || "application/octet-stream",
        3600
      );
      if (!signed.uploadUrl && !signed.token) {
        return json({ ok: false, error: "SIGNED_URL_FAILED" }, 500);
      }

      uploads.push({
        bucket: bucketUsed,
        path,
        token: signed.token,
        uploadUrl: signed.uploadUrl,
        fileName: displayName,
        mimeType,
        size
      });
    }

    return json({ ok: true, submissionId, uploads });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
