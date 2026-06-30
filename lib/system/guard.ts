import { cookies } from "next/headers";

import { dbFirst } from "@/lib/d1";
import { createDbServerClient } from "@/lib/db/server";
import { touchProfileActivity } from "@/lib/system/activityTouch";
import {
  isAdminRole,
  isLearnerRole,
  isSuperAdmin,
  normalizeSystemRole,
  type SystemRole
} from "@/lib/system/roles";
import {
  normalizeStudentStatus,
  STUDENT_STATUS_DONATION,
  STUDENT_STATUS_LEARNING,
  STUDENT_STATUS_NORMAL,
  STUDENT_STATUS_PASSED,
  STUDENT_STATUS_PASSED_DONATION
} from "@/lib/system/studentStatusValues";
import { ensureLearningStatus, hasUnlockedLearningEntryCourse } from "@/lib/system/studentStatus";

export type SystemStatus = "active" | "frozen" | "deleted";
export type { SystemRole };

export type StudentStatus =
  | typeof STUDENT_STATUS_NORMAL
  | typeof STUDENT_STATUS_PASSED
  | typeof STUDENT_STATUS_LEARNING
  | typeof STUDENT_STATUS_DONATION
  | typeof STUDENT_STATUS_PASSED_DONATION;

export type SystemUserSafe = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: SystemRole;
  leader_id: string | null;
  student_status: StudentStatus;
  status: SystemStatus;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: string;
  leader_id: string | null;
  student_status: string | null;
  status: string | null;
};

const PROFILE_FIELDS = "id,email,full_name,phone,role,leader_id,student_status,status";
const PROFILE_CACHE_TTL_MS = 60_000;
const PROFILE_CACHE_MAX_KEYS = 1_200;
type ProfileCacheEntry = { exp: number; value: ProfileRow | null };
const g = globalThis as {
  __fx_system_profile_by_session_cache?: Map<string, ProfileCacheEntry>;
  __fx_system_profile_by_session_inflight?: Map<string, Promise<ProfileRow | null>>;
};
if (!g.__fx_system_profile_by_session_cache) g.__fx_system_profile_by_session_cache = new Map();
if (!g.__fx_system_profile_by_session_inflight) g.__fx_system_profile_by_session_inflight = new Map();
const profileBySessionCache = g.__fx_system_profile_by_session_cache;
const profileBySessionInflight = g.__fx_system_profile_by_session_inflight;

function err(code: string) {
  const error = new Error(code);
  (error as any).code = code;
  return error;
}

function getSessionIdCandidates() {
  const all = cookies().getAll().filter((item) => item.name === "fxlocus_session_id");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of all) {
    const sessionId = String(item.value || "").trim();
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    out.push(sessionId);
  }
  return out;
}

function cloneProfileRow(row: ProfileRow | null) {
  if (!row) return null;
  return { ...row };
}

function sweepProfileBySessionCache(now: number) {
  if (!profileBySessionCache.size) return;
  for (const [key, entry] of profileBySessionCache.entries()) {
    if (entry.exp <= now) profileBySessionCache.delete(key);
  }
  if (profileBySessionCache.size <= PROFILE_CACHE_MAX_KEYS) return;
  const overflow = profileBySessionCache.size - PROFILE_CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of profileBySessionCache.keys()) {
    profileBySessionCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

async function fetchProfileBySession(sessionId: string) {
  if (!sessionId) return null;
  const now = Date.now();
  sweepProfileBySessionCache(now);
  const cached = profileBySessionCache.get(sessionId);
  if (cached && cached.exp > now) return cloneProfileRow(cached.value);

  const pending = profileBySessionInflight.get(sessionId);
  if (pending) return cloneProfileRow(await pending);

  const task = (async () => {
    try {
      return await dbFirst<ProfileRow>(
        `select ${PROFILE_FIELDS} from profiles where session_id = ? limit 1`,
        [sessionId]
      );
    } catch (error: any) {
      if (/no such column/i.test(String(error?.message || ""))) {
        throw err("SESSION_SCHEMA_MISSING");
      }
      throw error;
    }
  })();
  profileBySessionInflight.set(sessionId, task);
  try {
    const value = await task;
    profileBySessionCache.set(sessionId, {
      exp: Date.now() + PROFILE_CACHE_TTL_MS,
      value: cloneProfileRow(value)
    });
    return cloneProfileRow(value);
  } finally {
    profileBySessionInflight.delete(sessionId);
  }
}

async function resolveProfileBySessionCandidates(sessionIds: string[]) {
  for (const sessionId of sessionIds) {
    const profile = await fetchProfileBySession(sessionId);
    if (profile?.id) return profile;
  }
  return null;
}

export async function getSystemContext(): Promise<{
  user: SystemUserSafe;
  db: ReturnType<typeof createDbServerClient>;
}> {
  const sessionIds = getSessionIdCandidates();
  if (!sessionIds.length) throw err("UNAUTHORIZED");

  const profile = await resolveProfileBySessionCandidates(sessionIds);
  if (!profile?.id) throw err("UNAUTHORIZED");

  if (profile.status === "frozen" || profile.status === "deleted") {
    throw err("FROZEN");
  }

  const role = normalizeSystemRole(profile.role);
  if (!role) throw err("FORBIDDEN");
  let studentStatus = normalizeStudentStatus(profile.student_status, STUDENT_STATUS_NORMAL) as StudentStatus;
  if (
    role === "student" &&
    (studentStatus === STUDENT_STATUS_NORMAL || studentStatus === STUDENT_STATUS_PASSED)
  ) {
    const learningUnlocked = await hasUnlockedLearningEntryCourse(profile.id);
    if (learningUnlocked) {
      studentStatus = STUDENT_STATUS_LEARNING;
      await ensureLearningStatus(profile.id);
    }
  }
  touchProfileActivity(profile.id);

  const email = String(profile.email || "").trim().toLowerCase() || `${profile.id}@fxlocus.local`;
  let dbClient: ReturnType<typeof createDbServerClient> | null = null;
  const getDbClient = () => {
    if (!dbClient) {
      dbClient = createDbServerClient({ currentUserId: profile.id });
    }
    return dbClient;
  };

  return {
    get db() {
      return getDbClient();
    },
    user: {
      id: profile.id,
      email,
      full_name: profile.full_name ?? null,
      phone: profile.phone ?? null,
      role,
      leader_id: profile.leader_id ?? null,
      student_status: studentStatus,
      status: (profile.status || "active") as SystemStatus
    }
  };
}

export async function requireSystemUser() {
  return getSystemContext();
}

export async function requireAdmin() {
  const ctx = await requireSystemUser();
  if (!isAdminRole(ctx.user.role)) throw err("FORBIDDEN");
  return ctx;
}

export async function requireManager() {
  const ctx = await requireSystemUser();
  if (!isAdminRole(ctx.user.role) && ctx.user.role !== "coach" && ctx.user.role !== "assistant") {
    throw err("FORBIDDEN");
  }
  return ctx;
}

export async function requireStudent() {
  const ctx = await requireSystemUser();
  if (!isLearnerRole(ctx.user.role)) throw err("FORBIDDEN");
  return ctx;
}

export async function requireLearner() {
  const ctx = await requireSystemUser();
  if (!isLearnerRole(ctx.user.role) && ctx.user.role !== "leader") throw err("FORBIDDEN");
  return ctx;
}

export async function requireSuperAdmin() {
  const ctx = await requireSystemUser();
  if (!isSuperAdmin(ctx.user.role)) throw err("FORBIDDEN");
  return ctx;
}
