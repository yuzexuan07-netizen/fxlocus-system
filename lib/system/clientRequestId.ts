export function createClientRequestId(prefix: string) {
  const safePrefix = String(prefix || "req")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 32) || "req";
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${safePrefix}_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `${safePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
