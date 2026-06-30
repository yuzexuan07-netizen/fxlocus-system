import { dbAll } from "@/lib/d1";

type AssistantRow = { id: string | null };

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_KEYS = 400;

const g = globalThis as {
  __fx_assistant_assignment_cache?: Map<string, { exp: number; value: string[] }>;
  __fx_assistant_assignment_inflight?: Map<string, Promise<string[]>>;
};

if (!g.__fx_assistant_assignment_cache) g.__fx_assistant_assignment_cache = new Map();
if (!g.__fx_assistant_assignment_inflight) g.__fx_assistant_assignment_inflight = new Map();

const assistantAssignmentCache = g.__fx_assistant_assignment_cache;
const assistantAssignmentInflight = g.__fx_assistant_assignment_inflight;

function sweepAssistantAssignmentCache(now: number) {
  if (!assistantAssignmentCache.size) return;
  for (const [key, entry] of assistantAssignmentCache.entries()) {
    if (entry.exp <= now) assistantAssignmentCache.delete(key);
  }
  if (assistantAssignmentCache.size <= CACHE_MAX_KEYS) return;
  const overflow = assistantAssignmentCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of assistantAssignmentCache.keys()) {
    assistantAssignmentCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export async function fetchAssistantCreatedUserIds(assistantId: string) {
  const cacheKey = String(assistantId || "").trim();
  if (!cacheKey) return [];

  const now = Date.now();
  sweepAssistantAssignmentCache(now);
  const cached = assistantAssignmentCache.get(cacheKey);
  if (cached && cached.exp > now) return [...cached.value];

  const pending = assistantAssignmentInflight.get(cacheKey);
  if (pending) return [...(await pending)];

  const task = dbAll<AssistantRow>(
    "select id from profiles where created_by = ?",
    [cacheKey]
  ).then((rows) => rows.map((row) => String(row.id || "")).filter(Boolean));

  assistantAssignmentInflight.set(cacheKey, task);
  try {
    const value = await task;
    assistantAssignmentCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, value });
    return [...value];
  } finally {
    assistantAssignmentInflight.delete(cacheKey);
  }
}
