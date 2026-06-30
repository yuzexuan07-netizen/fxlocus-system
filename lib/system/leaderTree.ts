import { dbAll } from "@/lib/d1";

type LeaderRow = { id: string | null };

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_KEYS = 400;

const g = globalThis as {
  __fx_leader_tree_cache?: Map<string, { exp: number; value: string[] }>;
  __fx_leader_tree_inflight?: Map<string, Promise<string[]>>;
};

if (!g.__fx_leader_tree_cache) g.__fx_leader_tree_cache = new Map();
if (!g.__fx_leader_tree_inflight) g.__fx_leader_tree_inflight = new Map();

const leaderTreeCache = g.__fx_leader_tree_cache;
const leaderTreeInflight = g.__fx_leader_tree_inflight;

function sweepLeaderTreeCache(now: number) {
  if (!leaderTreeCache.size) return;
  for (const [key, entry] of leaderTreeCache.entries()) {
    if (entry.exp <= now) leaderTreeCache.delete(key);
  }
  if (leaderTreeCache.size <= CACHE_MAX_KEYS) return;
  const overflow = leaderTreeCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of leaderTreeCache.keys()) {
    leaderTreeCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export async function fetchLeaderTreeIds(leaderId: string) {
  const cacheKey = String(leaderId || "").trim();
  if (!cacheKey) return [];

  const now = Date.now();
  sweepLeaderTreeCache(now);
  const cached = leaderTreeCache.get(cacheKey);
  if (cached && cached.exp > now) return [...cached.value];

  const pending = leaderTreeInflight.get(cacheKey);
  if (pending) return [...(await pending)];

  const task = dbAll<LeaderRow>(
    `with recursive tree as (
      select id from profiles where id = ?
      union all
      select p.id from profiles p join tree t on p.leader_id = t.id
    )
    select id from tree`,
    [cacheKey]
  ).then((rows) => rows.map((row) => String(row.id || "")).filter(Boolean));

  leaderTreeInflight.set(cacheKey, task);
  try {
    const value = await task;
    leaderTreeCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, value });
    return [...value];
  } finally {
    leaderTreeInflight.delete(cacheKey);
  }
}
