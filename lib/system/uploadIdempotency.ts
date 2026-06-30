export function normalizeRequestId(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 96);
}

export function buildRequestScopedId(prefix: string, ...parts: Array<unknown>) {
  const normalized = [prefix, ...parts]
    .map((part) => normalizeRequestId(part))
    .filter(Boolean);
  return normalized.join("_");
}

export function buildRequestScopedPath(
  baseDir: string,
  requestId: string,
  suffix: string,
  fallbackFactory: () => string
) {
  const normalizedRequestId = normalizeRequestId(requestId);
  if (!normalizedRequestId) return fallbackFactory();
  return `${baseDir}/${normalizedRequestId}${suffix}`;
}
