const memoryLastRunAt = new Map<string, number>();

function normalizeInterval(value: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function storageKey(key: string) {
  return `fxlocus.poll.${String(key || "").trim()}`;
}

export function acquireGlobalPollSlot(key: string, minIntervalMs: number) {
  const normalizedKey = String(key || "").trim();
  const intervalMs = normalizeInterval(minIntervalMs);
  if (!normalizedKey || intervalMs <= 0) return true;

  const now = Date.now();
  const memLast = Number(memoryLastRunAt.get(normalizedKey) || 0);
  if (now - memLast < intervalMs) return false;

  if (typeof window === "undefined") {
    memoryLastRunAt.set(normalizedKey, now);
    return true;
  }

  try {
    const raw = window.localStorage.getItem(storageKey(normalizedKey));
    const persistedLast = Number(raw || "0");
    if (Number.isFinite(persistedLast) && now - persistedLast < intervalMs) return false;
  } catch {
    // ignore storage read failures
  }

  memoryLastRunAt.set(normalizedKey, now);
  try {
    window.localStorage.setItem(storageKey(normalizedKey), String(now));
  } catch {
    // ignore storage write failures
  }
  return true;
}

