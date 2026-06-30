import { NextRequest, NextResponse } from "next/server";

import { dbFirst } from "@/lib/d1";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { requireSystemUser } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { createSignedDownloadUrl } from "@/lib/storage/storage";
import { ensureDownloadFilename } from "@/lib/storage/filename";
import { getR2Bucket, r2Enabled, r2ObjectExists } from "@/lib/storage/r2";
import { buildStoragePathCandidates } from "@/lib/storage/path";
import { isLegacyR2BucketName } from "@/lib/storage/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubmissionFileRow = {
  id: string;
  file_name: string | null;
  mime_type: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  submission_user_id: string | null;
  submission_leader_id: string | null;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

async function canDownloadByRole(
  role: string | null | undefined,
  userId: string,
  row: SubmissionFileRow
) {
  if (!userId) return false;
  if (role === "super_admin") return true;
  if (row.submission_user_id && row.submission_user_id === userId) return true;
  if (row.submission_leader_id && row.submission_leader_id === userId) return true;
  const submissionUserId = String(row.submission_user_id || "").trim();
  if (!submissionUserId) return false;
  if (role === "leader") {
    const scopeIds = await fetchLeaderTreeIds(userId);
    return scopeIds.includes(submissionUserId);
  }
  if (role === "coach") {
    const scopeIds = await fetchCoachAssignedUserIds(userId);
    return scopeIds.includes(submissionUserId);
  }
  if (role === "assistant") {
    const scopeIds = await fetchAssistantCreatedUserIds(userId);
    return scopeIds.includes(submissionUserId);
  }
  return false;
}

function resolveDisposition(raw: string) {
  const value = String(raw || "").trim().toLowerCase();
  return value === "inline" ? "inline" : "attachment";
}

function buildContentDisposition(disposition: "inline" | "attachment", fileName: string) {
  const safeName = String(fileName || "download")
    .trim()
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(safeName || "download");
  return `${disposition}; filename="${safeName || "download"}"; filename*=UTF-8''${encoded}`;
}

function resolvePositiveContentLength(value: string | null) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return String(parsed);
}

export async function GET(req: NextRequest, context: { params: { fileId: string } }) {
  try {
    const { user } = await requireSystemUser();
    const fileId = String(context.params?.fileId || "").trim();
    if (!fileId) return json({ ok: false, error: "INVALID_FILE_ID" }, 400);

    const row = await dbFirst<SubmissionFileRow>(
      [
        "select",
        "  f.id,",
        "  f.file_name,",
        "  f.mime_type,",
        "  f.storage_bucket,",
        "  f.storage_path,",
        "  s.user_id as submission_user_id,",
        "  s.leader_id as submission_leader_id",
        "from trade_submission_files f",
        "join trade_submissions s on s.id = f.submission_id",
        "where f.id = ?",
        "limit 1"
      ].join(" "),
      [fileId]
    );

    if (!row?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);
    const allowed = await canDownloadByRole(user.role, user.id, row);
    if (!allowed) return json({ ok: false, error: "FORBIDDEN" }, 403);
    if (!row.storage_bucket || !row.storage_path) return json({ ok: false, error: "MISSING_STORAGE" }, 500);
    const disposition = resolveDisposition(req.nextUrl.searchParams.get("disposition") || "");
    const pathCandidates = Array.from(new Set(buildStoragePathCandidates(row.storage_path)));
    const preferredPath = pathCandidates[0] || row.storage_path;
    const r2Bucket = getR2Bucket();
    const isR2BackedBucket =
      r2Enabled() &&
      Boolean((r2Bucket && row.storage_bucket === r2Bucket) || isLegacyR2BucketName(row.storage_bucket));

    let resolvedPath = preferredPath;
    if (isR2BackedBucket && pathCandidates.length) {
      let found = "";
      for (const candidate of pathCandidates) {
        const exists = await r2ObjectExists(candidate);
        if (!exists) continue;
        found = candidate;
        break;
      }
      if (!found) return json({ ok: false, error: "MISSING_OBJECT" }, 404);
      resolvedPath = found;
    }

    const downloadName = ensureDownloadFilename(row.file_name, resolvedPath, row.mime_type);
    const signedUrl = await createSignedDownloadUrl(dbAdmin(), row.storage_bucket, resolvedPath, 3600, {
      disposition,
      filename: downloadName,
      contentType: row.mime_type
    });
    if (!signedUrl) return json({ ok: false, error: "SIGN_FAILED" }, 500);

    const mode = String(req.nextUrl.searchParams.get("mode") || "").trim().toLowerCase();
    if (mode === "proxy") {
      const upstream = await fetch(signedUrl, { method: "GET" });
      if (!upstream.ok || !upstream.body) {
        return json({ ok: false, error: "FETCH_FAILED" }, 502);
      }
      const headers = new Headers();
      headers.set(
        "Content-Type",
        String(row.mime_type || upstream.headers.get("content-type") || "application/octet-stream")
      );
      const contentLength = resolvePositiveContentLength(upstream.headers.get("content-length"));
      if (contentLength) headers.set("Content-Length", contentLength);
      headers.set("Content-Disposition", buildContentDisposition(disposition, downloadName));
      headers.set("Cache-Control", "private, no-store");
      return new NextResponse(upstream.body, { status: 200, headers });
    }
    if (mode === "json") {
      return json({ ok: true, url: signedUrl });
    }
    return NextResponse.redirect(signedUrl, 302);
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
