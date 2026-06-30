import { NextRequest, NextResponse } from "next/server";

import { dbFirst } from "@/lib/d1";
import { requireSystemUser } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { getR2Bucket, r2Enabled, r2ObjectExists, r2ReadObject } from "@/lib/storage/r2";
import { createSignedDownloadUrl, isLegacyR2BucketName } from "@/lib/storage/storage";
import { ensureDownloadFilename } from "@/lib/storage/filename";
import { buildStoragePathCandidates, normalizeStorageBucket, normalizeStoragePath } from "@/lib/storage/path";
import { extractStorageRefFromUrl } from "@/lib/storage/objectUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function wait(ms: number) {
  if (!ms) return Promise.resolve();
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchUpstreamWithRetry(url: string, headers?: HeadersInit) {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, { method: "GET", headers });
    if (res.ok && res.body) return res;
    last = res;
    const retryable = res.status === 429 || res.status === 503 || res.status >= 500;
    if (!retryable || attempt >= 2) break;
    await wait(160 * (attempt + 1) + Math.floor(Math.random() * 140));
  }
  return last;
}

function resolveAllowedPrefix(path: string) {
  const normalized = normalizeStoragePath(path).toLowerCase();
  if (!normalized) return null;
  const candidates = [
    "consult/audio/",
    "consult/images/",
    "course-notes/",
    "course-summaries/",
    "weekly-summaries/",
    "classic-trades/",
    "trade-logs/",
    "trade-strategies/"
  ] as const;
  for (const prefix of candidates) {
    if (normalized.startsWith(prefix)) return prefix;
  }
  return null;
}

const OWNERSHIP_CACHE_TTL_MS = 5 * 60 * 1000;
const OWNERSHIP_CACHE_MAX = 4000;
const cacheGlobal = globalThis as {
  __fx_storage_proxy_owned_cache?: Map<string, { value: boolean; exp: number }>;
};
if (!cacheGlobal.__fx_storage_proxy_owned_cache) {
  cacheGlobal.__fx_storage_proxy_owned_cache = new Map();
}
const ownedCache = cacheGlobal.__fx_storage_proxy_owned_cache;

function ownershipCacheKey(userId: string, bucket: string, path: string) {
  return `${userId}|${bucket}|${path}`;
}

function readOwnershipCache(userId: string, bucket: string, path: string) {
  const key = ownershipCacheKey(userId, bucket, path);
  const now = Date.now();
  const hit = ownedCache.get(key);
  if (!hit) return null;
  if (hit.exp <= now) {
    ownedCache.delete(key);
    return null;
  }
  return hit.value;
}

function writeOwnershipCache(userId: string, bucket: string, path: string, value: boolean) {
  const key = ownershipCacheKey(userId, bucket, path);
  ownedCache.set(key, { value, exp: Date.now() + OWNERSHIP_CACHE_TTL_MS });
  if (ownedCache.size <= OWNERSHIP_CACHE_MAX) return;
  const overflow = ownedCache.size - OWNERSHIP_CACHE_MAX;
  let removed = 0;
  for (const staleKey of ownedCache.keys()) {
    ownedCache.delete(staleKey);
    removed += 1;
    if (removed >= overflow) break;
  }
}

async function isLearnerPathOwnedByExactPath(userId: string, bucket: string, path: string) {
  if (!userId || !bucket || !path) return false;

  const checks = [
    dbFirst<{ ok: number }>(
      [
        "select 1 as ok",
        "from weekly_summaries",
        "where user_id = ?",
        "  and (",
        "    (strategy_bucket = ? and strategy_path = ?)",
        "    or (curve_bucket = ? and curve_path = ?)",
        "    or (stats_bucket = ? and stats_path = ?)",
        "  )",
        "limit 1"
      ].join(" "),
      [userId, bucket, path, bucket, path, bucket, path]
    ),
    dbFirst<{ ok: number }>(
      [
        "select 1 as ok",
        "from classic_trades",
        "where user_id = ? and image_bucket = ? and image_path = ?",
        "limit 1"
      ].join(" "),
      [userId, bucket, path]
    ),
    dbFirst<{ ok: number }>(
      [
        "select 1 as ok",
        "from trade_submission_files f",
        "join trade_submissions s on s.id = f.submission_id",
        "where s.user_id = ? and f.storage_bucket = ? and f.storage_path = ?",
        "limit 1"
      ].join(" "),
      [userId, bucket, path]
    ),
    dbFirst<{ ok: number }>(
      [
        "select 1 as ok",
        "from consult_messages",
        "where (from_user_id = ? or to_user_id = ?)",
        "  and image_bucket = ?",
        "  and image_path = ?",
        "limit 1"
      ].join(" "),
      [userId, userId, bucket, path]
    ),
    dbFirst<{ ok: number }>(
      [
        "select 1 as ok",
        "from student_documents",
        "where student_id = ? and storage_bucket = ? and storage_path = ?",
        "limit 1"
      ].join(" "),
      [userId, bucket, path]
    ),
    dbFirst<{ ok: number }>(
      [
        "select 1 as ok",
        "from files",
        "where uploaded_by = ? and storage_bucket = ? and (storage_path = ? or thumbnail_path = ?)",
        "limit 1"
      ].join(" "),
      [userId, bucket, path, path]
    )
  ] as const;

  for (const query of checks) {
    try {
      const row = await query;
      if (row?.ok) return true;
    } catch {
      // ignore single-table schema drift and keep checking other sources
    }
  }

  return false;
}

async function isLearnerPathOwned(userId: string, bucket: string, paths: string[]) {
  const candidates = Array.from(
    new Set(paths.map((item) => normalizeStoragePath(item)).filter(Boolean))
  );
  if (!userId || !bucket || !candidates.length) return false;

  for (const candidate of candidates) {
    const cached = readOwnershipCache(userId, bucket, candidate);
    if (cached === true) return true;
    if (cached === false) continue;
    const owned = await isLearnerPathOwnedByExactPath(userId, bucket, candidate);
    writeOwnershipCache(userId, bucket, candidate, owned);
    if (owned) return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireSystemUser();

    const rawBucketValues = req.nextUrl.searchParams
      .getAll("bucket")
      .map((value) => normalizeStorageBucket(String(value || "")))
      .filter(Boolean);
    let bucket = rawBucketValues[0] || "";

    const rawPathValues = req.nextUrl.searchParams
      .getAll("path")
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    let pathCandidates: string[] = [];
    for (const rawPath of rawPathValues) {
      let nextCandidates = buildStoragePathCandidates(rawPath);
      const firstCandidate = nextCandidates[0] || "";
      if (/^https?:\/\//i.test(rawPath) || /^https?:\/\//i.test(firstCandidate)) {
        const extracted = extractStorageRefFromUrl(rawPath) || extractStorageRefFromUrl(firstCandidate);
        if (extracted?.path) {
          const extractedBucket = normalizeStorageBucket(extracted.bucket);
          if (!bucket && extractedBucket) bucket = extractedBucket;
          nextCandidates = buildStoragePathCandidates(extracted.path);
        }
      }
      pathCandidates.push(...nextCandidates);
    }
    if (!pathCandidates.length) {
      const fallbackPath = String(req.nextUrl.searchParams.get("path") || "").trim();
      if (fallbackPath) {
        pathCandidates = buildStoragePathCandidates(fallbackPath);
      }
    }
    let path = pathCandidates[0] || "";

    pathCandidates = Array.from(
      new Set(pathCandidates.map((candidate) => normalizeStoragePath(candidate)).filter(Boolean))
    );
    const narrowedCandidates = pathCandidates
      .filter((candidate) => !/^https?:\/\//i.test(candidate))
      .filter((candidate) => !/^api\/system\/storage\/proxy/i.test(candidate))
      .filter((candidate) => !candidate.includes("bucket="))
      .filter((candidate) => !candidate.includes("path="));
    if (narrowedCandidates.length) {
      pathCandidates = narrowedCandidates;
      path = pathCandidates[0] || "";
    }

    if (!bucket || !pathCandidates.length) return json({ ok: false, error: "INVALID_STORAGE_REF" }, 400);
    if (pathCandidates.every((candidate) => /^https?:\/\//i.test(candidate))) {
      return json({ ok: false, error: "INVALID_PATH" }, 400);
    }

    const isManager =
      user.role === "super_admin" ||
      user.role === "leader" ||
      user.role === "assistant" ||
      user.role === "coach";
    if (!isManager) {
      const normalizedUserId = String(user.id || "").trim().toLowerCase();
      const supportedPrefix = pathCandidates.some((candidate) => Boolean(resolveAllowedPrefix(candidate)));
      const prefixMatched = pathCandidates.some((candidate) => {
        const prefix = resolveAllowedPrefix(candidate);
        if (!prefix) return false;
        const normalizedCandidate = normalizeStoragePath(candidate).toLowerCase();
        return Boolean(normalizedUserId && normalizedCandidate.startsWith(`${prefix}${normalizedUserId}/`));
      });
      if (!prefixMatched) {
        const owned = await isLearnerPathOwned(user.id, bucket, pathCandidates);
        if (!owned) {
          if (!supportedPrefix) return json({ ok: false, error: "UNSUPPORTED_PATH" }, 400);
          return json({ ok: false, error: "FORBIDDEN" }, 403);
        }
      }
    }

    const dispositionRaw = String(req.nextUrl.searchParams.get("disposition") || "").trim().toLowerCase();
    const disposition = dispositionRaw === "attachment" ? "attachment" : "inline";
    const filenameHint = String(
      req.nextUrl.searchParams.get("filename") || req.nextUrl.searchParams.get("name") || ""
    ).trim();
    const contentTypeHint = String(
      req.nextUrl.searchParams.get("contentType") || req.nextUrl.searchParams.get("mimeType") || ""
    )
      .trim()
      .slice(0, 160);
    const r2Bucket = getR2Bucket();
    const isR2BackedBucket =
      r2Enabled() && Boolean((r2Bucket && bucket === r2Bucket) || isLegacyR2BucketName(bucket));
    let uniqueCandidates = Array.from(new Set(pathCandidates));
    const preferredCandidates = uniqueCandidates.filter(
      (candidate) => !candidate.includes("?") && !candidate.includes("path=") && !/^api\/system\/storage\/proxy/i.test(candidate)
    );
    if (preferredCandidates.length) uniqueCandidates = preferredCandidates;
    let selectedPath = uniqueCandidates[0] || "";

    if (isR2BackedBucket && uniqueCandidates.length > 1) {
      let found = false;
      for (const candidate of uniqueCandidates) {
        const exists = await r2ObjectExists(candidate);
        if (!exists) continue;
        selectedPath = candidate;
        found = true;
        break;
      }
      if (!found) selectedPath = uniqueCandidates[0] || "";
    }

    const mode = String(req.nextUrl.searchParams.get("mode") || "").trim().toLowerCase();
    const downloadName = ensureDownloadFilename(filenameHint, selectedPath, contentTypeHint || null);
    path = selectedPath;
    if (mode === "json") {
      const signed = await createSignedDownloadUrl(dbAdmin(), bucket, selectedPath, 3600, {
        disposition,
        filename: downloadName,
        contentType: contentTypeHint || null
      });
      if (!signed) return json({ ok: false, error: "SIGN_FAILED" }, 500);
      return json({ ok: true, url: signed, path });
    }
    if (mode === "proxy") {
      const rangeHeader = req.headers.get("range");
      if (isR2BackedBucket) {
        const directObject = await r2ReadObject(selectedPath, rangeHeader);
        if (directObject?.body?.byteLength) {
          const headers = new Headers();
          headers.set(
            "Content-Type",
            String(contentTypeHint || directObject.contentType || "application/octet-stream")
          );
          headers.set("Content-Length", String(directObject.contentLength || directObject.body.byteLength));
          if (directObject.contentRange) headers.set("Content-Range", directObject.contentRange);
          headers.set("Accept-Ranges", String(directObject.acceptRanges || "bytes"));
          headers.set("Content-Disposition", buildContentDisposition(disposition, downloadName));
          headers.set("Cache-Control", "private, max-age=60");
          const bodyBytes = new Uint8Array(directObject.body.byteLength);
          bodyBytes.set(directObject.body);
          const body = new Blob([bodyBytes], {
            type: String(contentTypeHint || directObject.contentType || "application/octet-stream")
          });
          return new NextResponse(body, {
            status: directObject.status || (rangeHeader ? 206 : 200),
            headers
          });
        }
      }
      const signed = await createSignedDownloadUrl(dbAdmin(), bucket, selectedPath, 3600, {
        disposition,
        filename: downloadName,
        contentType: contentTypeHint || null
      });
      if (!signed) return json({ ok: false, error: "SIGN_FAILED" }, 500);
      const upstream = await fetchUpstreamWithRetry(
        signed,
        rangeHeader ? { Range: rangeHeader } : undefined
      );
      if (!upstream?.ok || !upstream.body) {
        // Fallback to redirect to avoid broken thumbnails when proxy path is throttled.
        const redirect = NextResponse.redirect(signed, 302);
        redirect.headers.set("Cache-Control", "private, max-age=120");
        return redirect;
      }
      const headers = new Headers();
      headers.set(
        "Content-Type",
        String(contentTypeHint || upstream.headers.get("content-type") || "application/octet-stream")
      );
      const contentLength = resolvePositiveContentLength(upstream.headers.get("content-length"));
      if (contentLength) headers.set("Content-Length", contentLength);
      const contentRange = String(upstream.headers.get("content-range") || "").trim();
      if (contentRange) headers.set("Content-Range", contentRange);
      headers.set("Accept-Ranges", String(upstream.headers.get("accept-ranges") || "bytes"));
      headers.set("Content-Disposition", buildContentDisposition(disposition, downloadName));
      headers.set("Cache-Control", "private, max-age=60");
      return new NextResponse(upstream.body, { status: upstream.status || 200, headers });
    }

    const signed = await createSignedDownloadUrl(dbAdmin(), bucket, selectedPath, 3600, {
      disposition,
      filename: downloadName,
      contentType: contentTypeHint || null
    });
    if (!signed) return json({ ok: false, error: "SIGN_FAILED" }, 500);

    const redirect = NextResponse.redirect(signed, 302);
    redirect.headers.set("Cache-Control", "private, max-age=300");
    return redirect;
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
