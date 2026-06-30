import { dbAll } from "@/lib/d1";

type AssignmentRow = { assigned_user_id: string | null };

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_KEYS = 400;

const g = globalThis as {
  __fx_coach_assignment_cache?: Map<string, { exp: number; value: string[] }>;
  __fx_coach_assignment_inflight?: Map<string, Promise<string[]>>;
};

if (!g.__fx_coach_assignment_cache) g.__fx_coach_assignment_cache = new Map();
if (!g.__fx_coach_assignment_inflight) g.__fx_coach_assignment_inflight = new Map();

const coachAssignmentCache = g.__fx_coach_assignment_cache;
const coachAssignmentInflight = g.__fx_coach_assignment_inflight;

function sweepCoachAssignmentCache(now: number) {
  if (!coachAssignmentCache.size) return;
  for (const [key, entry] of coachAssignmentCache.entries()) {
    if (entry.exp <= now) coachAssignmentCache.delete(key);
  }
  if (coachAssignmentCache.size <= CACHE_MAX_KEYS) return;
  const overflow = coachAssignmentCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of coachAssignmentCache.keys()) {
    coachAssignmentCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export async function fetchCoachAssignedUserIds(coachId: string) {
  const cacheKey = String(coachId || "").trim();
  if (!cacheKey) return [];

  const now = Date.now();
  sweepCoachAssignmentCache(now);
  const cached = coachAssignmentCache.get(cacheKey);
  if (cached && cached.exp > now) return [...cached.value];

  const pending = coachAssignmentInflight.get(cacheKey);
  if (pending) return [...(await pending)];

  const task = dbAll<AssignmentRow>(
    "select assigned_user_id from coach_assignments where coach_id = ?",
    [cacheKey]
  ).then((rows) => rows.map((row) => String(row.assigned_user_id || "")).filter(Boolean));

  coachAssignmentInflight.set(cacheKey, task);
  try {
    const value = await task;
    coachAssignmentCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, value });
    return [...value];
  } finally {
    coachAssignmentInflight.delete(cacheKey);
  }
}

export async function fetchCoachAssignedUserSet(coachId: string): Promise<Set<string>> {
  const ids = await fetchCoachAssignedUserIds(coachId);
  return new Set(ids);
}
