import { dbAdmin } from "@/lib/system/dbAdmin";
import {
  getR2Bucket,
  isR2Bucket,
  r2DeleteObjects,
  r2ObjectExists,
  r2PresignGet,
  r2PresignPut,
  r2UploadBuffer
} from "@/lib/storage/r2";
import { buildStoragePathCandidates, normalizeStorageBucket, normalizeStoragePath } from "@/lib/storage/path";

const SIGNED_URL_CACHE_TTL_MS = 5 * 60 * 1000;
const SIGNED_URL_CACHE_MAX_SIZE = 2000;
const SIGNED_URL_CACHE_SWEEP_MS = 30_000;
const LEGACY_R2_BUCKETS = new Set<string>();
export const isLegacyR2BucketName = (bucket: string | null | undefined) =>
  Boolean(bucket && LEGACY_R2_BUCKETS.has(bucket));
export const isKnownStorageBucketName = (bucket: string | null | undefined) =>
  isLegacyR2BucketName(bucket) || isR2Bucket(bucket);
const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);
const g = globalThis as {
  __fx_signed_url_cache?: Map<string, { exp: number; url: string }>;
  __fx_signed_url_cache_last_sweep_at?: number;
};
if (!g.__fx_signed_url_cache) g.__fx_signed_url_cache = new Map();
if (!g.__fx_signed_url_cache_last_sweep_at) g.__fx_signed_url_cache_last_sweep_at = 0;
const signedUrlCache = g.__fx_signed_url_cache;

function sweepSignedUrlCache(now: number) {
  const shouldSweep =
    now - Number(g.__fx_signed_url_cache_last_sweep_at || 0) >= SIGNED_URL_CACHE_SWEEP_MS ||
    signedUrlCache.size > SIGNED_URL_CACHE_MAX_SIZE;
  if (!shouldSweep) return;
  g.__fx_signed_url_cache_last_sweep_at = now;

  for (const [key, value] of signedUrlCache.entries()) {
    if (value.exp <= now) signedUrlCache.delete(key);
  }

  if (signedUrlCache.size > SIGNED_URL_CACHE_MAX_SIZE) {
    const overflow = signedUrlCache.size - SIGNED_URL_CACHE_MAX_SIZE;
    let removed = 0;
    for (const key of signedUrlCache.keys()) {
      signedUrlCache.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }
}

export type StorageItem = { bucket: string; path: string };

type SignedUrlOptions = {
  disposition?: "inline" | "attachment";
  filename?: string | null;
  contentType?: string | null;
};

export async function createSignedDownloadUrl(
  admin: ReturnType<typeof dbAdmin>,
  bucket: string | null | undefined,
  path: string | null | undefined,
  expiresIn = 3600,
  options?: SignedUrlOptions
) {
  const normalizedBucket = normalizeStorageBucket(bucket);
  const pathCandidates = Array.from(new Set(buildStoragePathCandidates(path)));
  if (!normalizedBucket || !pathCandidates.length) return null;
  const now = Date.now();
  sweepSignedUrlCache(now);
  const disposition = options?.disposition === "attachment" ? "attachment" : "inline";
  const safeFilename = String(options?.filename || "").trim();
  const effectiveFilename = disposition === "attachment" ? safeFilename : "";
  const safeContentType = String(options?.contentType || "").trim();

  let url: string | null = null;
  const r2Bucket = getR2Bucket();
  const isR2Name = Boolean(normalizedBucket && r2Bucket && normalizedBucket === r2Bucket);
  const isLegacyName = isLegacyR2BucketName(normalizedBucket);
  const tryDbSigned = async (candidatePath: string) => {
    try {
      const downloadOptions: Record<string, unknown> = {};
      if (disposition === "attachment") {
        downloadOptions.download = effectiveFilename || true;
      }
      const storageBucket = admin.storage.from(normalizedBucket) as any;
      const createSignedUrl = storageBucket?.createSignedUrl;
      if (typeof createSignedUrl !== "function") return null;
      const signed = await createSignedUrl(
        candidatePath,
        expiresIn,
        Object.keys(downloadOptions).length ? downloadOptions : undefined
      );
      return signed.error ? null : signed.data?.signedUrl || null;
    } catch {
      return null;
    }
  };
  const tryR2Signed = async (candidatePath: string) => {
    try {
      return await r2PresignGet(candidatePath, expiresIn, {
        disposition,
        filename: effectiveFilename || undefined,
        contentType: safeContentType || undefined
      });
    } catch {
      return null;
    }
  };
  const candidatePaths = [...pathCandidates];
  const firstHttpPath = candidatePaths.find((candidate) => isHttpUrl(candidate));
  const nonHttpCandidates = candidatePaths.filter((candidate) => !isHttpUrl(candidate));
  const normalizedCandidates = nonHttpCandidates.filter(
    (candidate) =>
      !/^api\/system\/storage\/proxy/i.test(candidate) &&
      !candidate.includes("bucket=") &&
      !candidate.includes("path=")
  );
  let selectedCandidates = normalizedCandidates.length
    ? normalizedCandidates
    : nonHttpCandidates.length
      ? nonHttpCandidates
      : candidatePaths;
  if (!selectedCandidates.length && firstHttpPath) return firstHttpPath;

  const hasR2Fallback = isR2Name || isLegacyName;
  let hasExistingR2Candidate = false;
  if (hasR2Fallback && selectedCandidates.length) {
    const existingCandidates: string[] = [];
    for (const candidate of selectedCandidates) {
      const exists = await r2ObjectExists(candidate);
      if (!exists) continue;
      existingCandidates.push(candidate);
    }
    if (existingCandidates.length) {
      hasExistingR2Candidate = true;
      selectedCandidates = existingCandidates;
    }
  }
  if (hasR2Fallback && !hasExistingR2Candidate && !firstHttpPath) return null;

  for (const candidatePath of selectedCandidates) {
    const cacheKey = `${normalizedBucket}|${candidatePath}|${expiresIn}|${disposition}|${effectiveFilename}|${safeContentType}`;
    const cached = signedUrlCache.get(cacheKey);
    if (cached && cached.exp > now) return cached.url;

    if (isR2Name) {
      url = await tryR2Signed(candidatePath);
      if (!url) url = await tryDbSigned(candidatePath);
    } else if (isLegacyName) {
      // Migration compatibility:
      // legacy bucket rows may already point to R2 keys but keep the old bucket name.
      url = await tryR2Signed(candidatePath);
      if (!url) url = await tryDbSigned(candidatePath);
    } else {
      url = await tryDbSigned(candidatePath);
      if (!url) url = await tryR2Signed(candidatePath);
    }
    if (!url) continue;

    const ttl = Math.min(SIGNED_URL_CACHE_TTL_MS, Math.max(60_000, (expiresIn - 60) * 1000));
    signedUrlCache.set(cacheKey, { exp: now + ttl, url });
    return url;
  }
  if (hasR2Fallback && selectedCandidates.length && !firstHttpPath) return null;
  if (!nonHttpCandidates.length && firstHttpPath) return firstHttpPath;
  return null;
}

export async function createSignedUploadUrl(
  admin: ReturnType<typeof dbAdmin>,
  bucket: string,
  path: string,
  contentType: string,
  expiresIn = 3600
) {
  const normalizedBucket = normalizeStorageBucket(bucket);
  const normalizedPath = normalizeStoragePath(path);
  if (isR2Bucket(normalizedBucket) || isLegacyR2BucketName(normalizedBucket)) {
    const uploadUrl = await r2PresignPut(
      normalizedPath,
      contentType || "application/octet-stream",
      expiresIn
    );
    return { uploadUrl, token: null as string | null };
  }
  const { data, error } = await admin.storage
    .from(normalizedBucket)
    .createSignedUploadUrl(normalizedPath);
  if (error || !data?.token) return { uploadUrl: null as string | null, token: null as string | null };
  return { uploadUrl: null as string | null, token: data.token };
}

export async function uploadBufferToStorage(
  admin: ReturnType<typeof dbAdmin>,
  bucket: string,
  path: string,
  body: Buffer | ArrayBuffer,
  contentType: string
) {
  const normalizedBucket = normalizeStorageBucket(bucket);
  const normalizedPath = normalizeStoragePath(path);
  if (isR2Bucket(normalizedBucket) || isLegacyR2BucketName(normalizedBucket)) {
    await r2UploadBuffer(normalizedPath, body, contentType || "application/octet-stream");
    return;
  }
  const res = await admin.storage.from(normalizedBucket).upload(normalizedPath, body, {
    contentType: contentType || "application/octet-stream",
    upsert: false
  });
  if (res.error) throw new Error(res.error.message || "UPLOAD_FAILED");
}

export async function removeStoredObjects(
  admin: ReturnType<typeof dbAdmin>,
  items: StorageItem[]
) {
  if (!items.length) return;
  const r2Keys = new Set<string>();
  const byBucket = new Map<string, string[]>();
  items.forEach((item) => {
    const bucket = normalizeStorageBucket(item.bucket);
    const pathCandidates = Array.from(new Set(buildStoragePathCandidates(item.path)));
    if (!bucket || !pathCandidates.length) return;
    if (isR2Bucket(bucket) || isLegacyR2BucketName(bucket)) {
      pathCandidates.forEach((path) => r2Keys.add(path));
      return;
    }
    const list = byBucket.get(bucket) || [];
    list.push(...pathCandidates);
    byBucket.set(bucket, list);
  });

  if (r2Keys.size) {
    await r2DeleteObjects(Array.from(r2Keys));
  }
  for (const [bucket, paths] of byBucket.entries()) {
    await admin.storage.from(bucket).remove(Array.from(new Set(paths)));
  }
}
