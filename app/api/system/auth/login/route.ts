import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import { dbFirst, dbRun } from "@/lib/d1";
import { verifyLocalAuthCredentials } from "@/lib/system/localAuth";
import { clearLoginAttempts, consumeLoginAttempt, getLoginRateLimitConfig } from "@/lib/system/loginRateLimit";
import { normalizeSystemRole } from "@/lib/system/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NormalizedRole = "super_admin" | "leader" | "student" | "trader" | "coach" | "assistant";
type ProfileRow = {
  id: string;
  email: string | null;
  role: string;
  last_login_at?: string | null;
  last_login_ip?: string | null;
  last_login_user_agent?: string | null;
  session_id?: string | null;
};

const PROFILE_FIELDS = "id,email,role,last_login_at,last_login_ip,last_login_user_agent,session_id";
const PROFILE_FIELDS_LEGACY = "id,email,role,last_login_at,session_id";
const PROFILE_FIELDS_MIN = "id,email,role,last_login_at";
const PROFILE_FIELDS_ID_ONLY = "id,email,role";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function normalizeEmail(input: unknown) {
  return String(input || "").trim().toLowerCase();
}

function isValidEmail(email: string) {
  // Keep this intentionally permissive to avoid blocking legacy accounts.
  return /^\S+@\S+\.\S+$/.test(email);
}

function getIpFromHeaders(headers: Headers) {
  const forwarded = String(headers.get("x-forwarded-for") || "").trim();
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  const realIp = String(headers.get("x-real-ip") || "").trim();
  return realIp || "unknown";
}

function buildPasswordCandidates(password: string) {
  const raw = String(password || "").trim();
  if (!raw) return [] as string[];

  const candidates = new Set<string>([raw]);
  const stripped = raw.replace(/[\s\u3000\u00a0]+$/g, "");
  if (stripped) candidates.add(stripped);

  // Handle accidental trailing full-width punctuation from IME input.
  const strippedPunctuation = stripped.replace(/[，。！？；：、]+$/g, "");
  if (strippedPunctuation) candidates.add(strippedPunctuation);

  return Array.from(candidates);
}

function isTransientLoginError(error: unknown) {
  const text = `${String((error as any)?.code || "")} ${String((error as any)?.message || "")}`.toLowerCase();
  return (
    text.includes("sqlite_busy") ||
    text.includes("database is locked") ||
    text.includes("database is busy") ||
    text.includes("service unavailable") ||
    text.includes("temporarily unavailable")
  );
}

function wait(ms: number) {
  if (!ms) return Promise.resolve();
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runBestEffortInBackground(task: () => Promise<unknown>) {
  void (async () => {
    try {
      const { ctx } = await getCloudflareContext({ async: true });
      ctx.waitUntil(Promise.resolve().then(task).catch(() => null));
      return;
    } catch {
      // Fall back to a detached promise when waitUntil isn't available.
    }
    void Promise.resolve().then(task).catch(() => null);
  })();
}

async function recordLoginState(input: {
  profile: ProfileRow;
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
  persistSessionId: boolean;
}) {
  const now = new Date().toISOString();
  const userAgent = String(input.userAgent || "").trim();
  const previousUserAgent = String(input.profile.last_login_user_agent || "").trim();
  const deviceChanged = Boolean(previousUserAgent && userAgent && previousUserAgent !== userAgent);

  if (input.persistSessionId) {
    try {
      await dbRun(
        "update profiles set last_login_at = ?, last_login_ip = ?, last_login_user_agent = ?, session_id = ?, updated_at = ? where id = ?",
        [now, input.ip || null, userAgent || null, input.sessionId, now, input.profile.id]
      );
    } catch {
      await dbRun("update profiles set last_login_at = ?, session_id = ?, updated_at = ? where id = ?", [
        now,
        input.sessionId,
        now,
        input.profile.id
      ]);
    }
  } else {
    try {
      await dbRun(
        "update profiles set last_login_at = ?, last_login_ip = ?, last_login_user_agent = ?, updated_at = ? where id = ?",
        [now, input.ip || null, userAgent || null, now, input.profile.id]
      );
    } catch {
      await dbRun("update profiles set last_login_at = ?, updated_at = ? where id = ?", [
        now,
        now,
        input.profile.id
      ]);
    }
  }

  if (!deviceChanged) return;
}

async function fetchProfileWithFallback(
  userId: string
): Promise<{ profile: ProfileRow | null; error?: string; fields: string }> {
  const fieldSets = [PROFILE_FIELDS, PROFILE_FIELDS_LEGACY, PROFILE_FIELDS_MIN, PROFILE_FIELDS_ID_ONLY];
  for (const fields of fieldSets) {
    try {
      const profile = await dbFirst<ProfileRow>(`select ${fields} from profiles where id = ? limit 1`, [userId]);
      return { profile: profile || null, fields };
    } catch (error: any) {
      const message = String(error?.message || "");
      if (!/no such column/i.test(message)) {
        return { profile: null, error: message || "PROFILE_QUERY_FAILED", fields };
      }
    }
  }
  return { profile: null, error: "PROFILE_QUERY_FAILED", fields: PROFILE_FIELDS_ID_ONLY };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as any;
    const email = normalizeEmail(body?.email ?? body?.identifier ?? body?.username);
    const passwordRaw = String(body?.password ?? body?.pwd ?? "");
    const roleRaw = body?.role ?? body?.accountType ?? body?.type ?? body?.loginAs ?? body?.identity;
    const expectedRole = normalizeSystemRole(roleRaw) as NormalizedRole | null;

    if (!email || !passwordRaw) return json({ ok: false, error: "MISSING_CREDENTIALS" }, 400);
    if (!isValidEmail(email)) return json({ ok: false, error: "INVALID_EMAIL" }, 400);
    if (!expectedRole) return json({ ok: false, error: "INVALID_ROLE" }, 400);

    const passwordCandidates = buildPasswordCandidates(passwordRaw);
    if (!passwordCandidates.length) return json({ ok: false, error: "MISSING_CREDENTIALS" }, 400);

    const rateBeforeAuth = await consumeLoginAttempt(req.headers, email);
    if (rateBeforeAuth.limited) {
      const cfg = getLoginRateLimitConfig();
      return NextResponse.json(
        {
          ok: false,
          error: "RATE_LIMITED",
          retry_after_sec: rateBeforeAuth.retryAfterSec,
          window_ms: cfg.windowMs
        },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(rateBeforeAuth.retryAfterSec)
          }
        }
      );
    }

    let authMatched: { userId: string; email: string } | null = null;
    for (const candidate of passwordCandidates) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          authMatched = await verifyLocalAuthCredentials(email, candidate);
          break;
        } catch (error) {
          if (!isTransientLoginError(error) || attempt >= 2) throw error;
          await wait(100 + attempt * 160);
        }
      }
      if (authMatched?.userId) break;
    }
    if (!authMatched?.userId) {
      return json({ ok: false, error: "INVALID_CREDENTIALS" }, 401);
    }
    const userId = authMatched.userId;
    const profileResult = await fetchProfileWithFallback(userId);
    if (profileResult.error) {
      return json(
        {
          ok: false,
          error: "PROFILE_QUERY_FAILED",
          message: profileResult.error,
          fields: profileResult.fields
        },
        500
      );
    }

    let profile = profileResult.profile;
    if (!profile && expectedRole === "student") {
      const now = new Date().toISOString();
      await dbRun(
        `insert or ignore into profiles
          (id, email, role, student_status, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
        [userId, email, "student", "普通学员", "active", now, now]
      );
      const retry = await fetchProfileWithFallback(userId);
      if (retry.error) {
        return json({ ok: false, error: "PROFILE_QUERY_FAILED", message: retry.error, fields: retry.fields }, 500);
      }
      profile = retry.profile;
    }

    if (!profile) {
      return json(
        {
          ok: false,
          error: "PROFILE_MISSING",
          hint: "请先在 D1 的 profiles 表创建该用户记录。"
        },
        500
      );
    }

    const actualRole = normalizeSystemRole(profile.role) as NormalizedRole | null;
    if (!actualRole) return json({ ok: false, error: "INVALID_ROLE" }, 403);

    const learnerRoles = new Set<NormalizedRole>(["student", "trader"]);
    const roleMatched = expectedRole === "student" ? learnerRoles.has(actualRole) : actualRole === expectedRole;
    if (!roleMatched) {
      return json({ ok: false, error: "ROLE_MISMATCH", expectedRole, actualRole }, 403);
    }

    const cookieStore = cookies();
    const cookieDomain = String(process.env.SYSTEM_COOKIE_DOMAIN || "").trim() || undefined;
    const forwardedProto = req.headers.get("x-forwarded-proto") || "";
    const isSecure = forwardedProto === "https" || req.nextUrl.protocol === "https:";

    // Reuse existing active session id when available so another login of the same
    // account does not invalidate already-open tabs/devices immediately.
    const existingSessionId = String(profile.session_id || "").trim();
    const sessionId = existingSessionId || crypto.randomUUID();
    const forwarded = req.headers.get("x-forwarded-for") || "";
    const ip = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
    const userAgent = req.headers.get("user-agent") || "";
    const isMobileAppLogin = /FxLocusMobile/i.test(userAgent);
    const sessionCookieOptions = {
      httpOnly: true as const,
      secure: isSecure,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 60 * 60 * 24 * (isMobileAppLogin ? 3650 : 30)
    };

    cookieStore.set("fxlocus_session_id", sessionId, sessionCookieOptions);
    if (cookieDomain) {
      cookieStore.set("fxlocus_session_id", sessionId, { ...sessionCookieOptions, domain: cookieDomain });
    }

    await recordLoginState({
      profile,
      sessionId,
      ip: ip || null,
      userAgent: userAgent || null,
      persistSessionId: !existingSessionId
    });
    runBestEffortInBackground(async () => {
      await clearLoginAttempts(getIpFromHeaders(req.headers), email);
    });

    return json({
      ok: true,
      role: profile.role,
      data: {
        role: profile.role,
        profile: {
          id: profile.id,
          email: profile.email,
          role: profile.role
        }
      },
      profile: {
        id: profile.id,
        email: profile.email,
        role: profile.role
      },
      user: {
        id: profile.id,
        email: profile.email,
        full_name: null,
        role: profile.role
      }
    });
  } catch (error: any) {
    if (isTransientLoginError(error)) {
      return NextResponse.json(
        { ok: false, error: "SERVICE_UNAVAILABLE" },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "1"
          }
        }
      );
    }
    return json({ ok: false, error: "UNHANDLED", message: error?.message ?? String(error) }, 500);
  }
}
