import { NextRequest, NextResponse } from "next/server";

import { dbFirst, dbRun } from "@/lib/d1";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { requireSystemUser } from "@/lib/system/guard";
import { getIpFromHeaders, getUserAgent } from "@/lib/system/requestMeta";
import { createSignedDownloadUrl } from "@/lib/storage/storage";
import { ensureDownloadFilename } from "@/lib/storage/filename";
import { getR2Bucket, r2Enabled, r2ObjectExists } from "@/lib/storage/r2";
import { buildStoragePathCandidates } from "@/lib/storage/path";
import { isLegacyR2BucketName } from "@/lib/storage/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FileRow = {
  id: string;
  file_name: string | null;
  mime_type: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
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

function isAllowedDisposition(value: string) {
  return value === "inline" || value === "attachment";
}

function resolveDisposition(value: string): "inline" | "attachment" {
  return isAllowedDisposition(value) ? (value as "inline" | "attachment") : "inline";
}

async function resolveSignedUrl(fileId: string, disposition: "inline" | "attachment") {
  const { user } = await requireSystemUser();
  const row = await dbFirst<FileRow>(
    "select id, name as file_name, mime_type, storage_bucket, storage_path from files where id = ? limit 1",
    [fileId]
  );
  if (!row?.id) return { error: "NOT_FOUND" as const };

  let allowed = user.role === "super_admin";
  if (!allowed) {
    const seg = String(row.storage_path || "").split("/")[0];
    if (seg && seg === user.id) {
      allowed = true;
    } else {
      const perm = await dbFirst<{ file_id: string }>(
        "select file_id from file_permissions where file_id = ? and grantee_profile_id = ? limit 1",
        [fileId, user.id]
      );
      allowed = Boolean(perm?.file_id);
    }
  }
  if (!allowed) return { error: "FORBIDDEN" as const };

  if (!row.storage_bucket || !row.storage_path) return { error: "MISSING_STORAGE" as const };
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
    if (!found) return { error: "MISSING_OBJECT" as const };
    resolvedPath = found;
  }

  const admin = dbAdmin();
  const downloadName = ensureDownloadFilename(row.file_name, resolvedPath, row.mime_type);
  const signedUrl = await createSignedDownloadUrl(admin, row.storage_bucket, resolvedPath, 3600, {
    disposition,
    filename: downloadName,
    contentType: row.mime_type
  });
  if (!signedUrl) return { error: "SIGN_FAILED" as const };

  return {
    ok: true as const,
    signedUrl,
    userId: user.id,
    downloadName,
    mimeType: row.mime_type || null,
    disposition
  };
}

export async function GET(req: NextRequest, context: { params: { fileId: string } }) {
  try {
    const fileId = String(context.params?.fileId || "").trim();
    if (!fileId) return json({ ok: false, error: "INVALID_FILE_ID" }, 400);

    const dispositionRaw = String(req.nextUrl.searchParams.get("disposition") || "").trim().toLowerCase();
    const disposition = resolveDisposition(dispositionRaw);
    const mode = String(req.nextUrl.searchParams.get("mode") || "").trim().toLowerCase();

    const resolved = await resolveSignedUrl(fileId, disposition);
    if ("error" in resolved) {
      const status =
        resolved.error === "NOT_FOUND"
          ? 404
          : resolved.error === "FORBIDDEN"
            ? 403
            : resolved.error === "MISSING_OBJECT"
              ? 404
              : resolved.error === "MISSING_STORAGE" || resolved.error === "SIGN_FAILED"
                ? 500
                : 400;
      return json({ ok: false, error: resolved.error }, status);
    }

    await dbRun(
      "insert into file_download_logs (file_id, user_id, ip, user_agent, downloaded_at) values (?, ?, ?, ?, ?)",
      [fileId, resolved.userId, getIpFromHeaders(req.headers), getUserAgent(req.headers), new Date().toISOString()]
    );

    if (mode === "json") {
      return json({ ok: true, url: resolved.signedUrl });
    }
    if (mode === "proxy") {
      const upstream = await fetch(resolved.signedUrl, { method: "GET" });
      if (!upstream.ok || !upstream.body) {
        return json({ ok: false, error: "FETCH_FAILED" }, 502);
      }
      const headers = new Headers();
      headers.set(
        "Content-Type",
        String(resolved.mimeType || upstream.headers.get("content-type") || "application/octet-stream")
      );
      const contentLength = resolvePositiveContentLength(upstream.headers.get("content-length"));
      if (contentLength) headers.set("Content-Length", contentLength);
      headers.set("Content-Disposition", buildContentDisposition(resolved.disposition, resolved.downloadName));
      headers.set("Cache-Control", "private, no-store");
      return new NextResponse(upstream.body, { status: 200, headers });
    }
    return NextResponse.redirect(resolved.signedUrl, 302);
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
