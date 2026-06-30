import { getR2Bucket } from "@/lib/storage/r2";
import { isKnownStorageBucketName } from "@/lib/storage/storage";
import { normalizeStorageBucket, normalizeStoragePath } from "@/lib/storage/path";

type StorageRef = {
  bucket: string;
  path: string;
};

type BuildStorageProxyUrlOptions = {
  filename?: string | null;
  contentType?: string | null;
  disposition?: "inline" | "attachment";
};

function withScheme(raw: string) {
  const input = String(raw || "").trim();
  if (!input) return "";
  if (input.startsWith("http://") || input.startsWith("https://")) return input;
  return `https://${input}`;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getHost(raw: string) {
  const normalized = withScheme(raw);
  if (!normalized) return "";
  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const r2EndpointHost = getHost(process.env.R2_ENDPOINT || "");
const r2PublicHost = getHost(process.env.R2_PUBLIC_BASE_URL || process.env.R2_CDN_BASE_URL || "");

export function buildStorageProxyUrl(
  bucket: string,
  path: string,
  options?: BuildStorageProxyUrlOptions
) {
  let normalizedBucket = normalizeStorageBucket(bucket);
  let normalizedPath = normalizeStoragePath(path);
  const extracted = extractStorageRefFromUrl(normalizedPath);
  if (extracted?.path) {
    normalizedPath = normalizeStoragePath(extracted.path);
    const extractedBucket = normalizeStorageBucket(extracted.bucket);
    if (extractedBucket) normalizedBucket = extractedBucket;
  }
  const params = new URLSearchParams();
  params.set("bucket", normalizedBucket);
  params.set("path", normalizedPath);

  const filename = String(options?.filename || "").trim();
  if (filename) params.set("filename", filename);

  const contentType = String(options?.contentType || "").trim();
  if (contentType) params.set("contentType", contentType);

  if (options?.disposition === "attachment") params.set("disposition", "attachment");

  return `/api/system/storage/proxy?${params.toString()}`;
}

export function extractStorageRefFromUrl(rawUrl: string): StorageRef | null {
  const input = String(rawUrl || "").trim();
  if (!input) return null;

  let url: URL;
  try {
    url = input.startsWith("/")
      ? new URL(input, "https://fxlocus.local")
      : new URL(input);
  } catch {
    return null;
  }

  if (!/^https?:$/i.test(url.protocol)) return null;
  const pathname = url.pathname.replace(/^\/+/, "");
  if (!pathname) return null;

  if (url.pathname === "/api/system/storage/proxy") {
    const bucket = normalizeStorageBucket(String(url.searchParams.get("bucket") || ""));
    const path = normalizeStoragePath(String(url.searchParams.get("path") || ""));
    if (!bucket || !path) return null;
    return { bucket, path };
  }

  const legacyStorageMatch = pathname.match(/^storage\/v1\/object\/(?:sign|public)\/([^/]+)\/(.+)$/i);
  if (legacyStorageMatch) {
    return {
      bucket: normalizeStorageBucket(safeDecode(legacyStorageMatch[1] || "")),
      path: normalizeStoragePath(safeDecode(legacyStorageMatch[2] || ""))
    };
  }

  const r2Bucket = getR2Bucket();
  const host = url.hostname.toLowerCase();
  if (r2Bucket && host.startsWith(`${r2Bucket.toLowerCase()}.`)) {
    return { bucket: normalizeStorageBucket(r2Bucket), path: normalizeStoragePath(safeDecode(pathname)) };
  }

  const slashIndex = pathname.indexOf("/");
  if (slashIndex > 0) {
    const first = safeDecode(pathname.slice(0, slashIndex));
    const rest = safeDecode(pathname.slice(slashIndex + 1));
    if (rest && isKnownStorageBucketName(first)) {
      return { bucket: normalizeStorageBucket(first), path: normalizeStoragePath(rest) };
    }
    if (rest && r2EndpointHost && host === r2EndpointHost && r2Bucket && first === r2Bucket) {
      return { bucket: normalizeStorageBucket(first), path: normalizeStoragePath(rest) };
    }
  }

  if (r2PublicHost && host === r2PublicHost && r2Bucket) {
    return { bucket: normalizeStorageBucket(r2Bucket), path: normalizeStoragePath(safeDecode(pathname)) };
  }

  return null;
}

const ATTR_URL_RE = /\b(src|href)\s*=\s*(['"])(https?:\/\/[^"'<>]+)\2/gi;

export function rewriteHtmlStorageUrlsToProxy(html: string) {
  const raw = String(html || "");
  if (!raw || raw.indexOf("http") === -1) return raw;

  const replacement = new Map<string, string>();
  let match: RegExpExecArray | null = null;
  while ((match = ATTR_URL_RE.exec(raw))) {
    const sourceUrl = String(match[3] || "");
    if (!sourceUrl || replacement.has(sourceUrl)) continue;
    const ref = extractStorageRefFromUrl(sourceUrl);
    if (!ref?.bucket || !ref.path) continue;
    replacement.set(sourceUrl, buildStorageProxyUrl(ref.bucket, ref.path));
  }

  if (!replacement.size) return raw;
  return raw.replace(ATTR_URL_RE, (full, attr, quote, sourceUrl) => {
    const next = replacement.get(sourceUrl);
    return next ? `${attr}=${quote}${next}${quote}` : full;
  });
}
