import { NextRequest, NextResponse } from "next/server";
import { dbRun, sqlPlaceholders } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = req.cookies;
    const sessionIds = cookieStore
      .getAll()
      .filter((item) => item.name === "fxlocus_session_id")
      .map((item) => String(item.value || "").trim())
      .filter(Boolean);

    if (sessionIds.length) {
      await dbRun(
        `update profiles set session_id = null, updated_at = ?
         where session_id in (${sqlPlaceholders(sessionIds.length)})`,
        [new Date().toISOString(), ...sessionIds]
      );

      const g = globalThis as {
        __fx_system_profile_by_session_cache?: Map<string, { exp: number; value: unknown }>;
        __fx_system_profile_by_session_inflight?: Map<string, Promise<unknown>>;
      };
      sessionIds.forEach((sessionId) => {
        g.__fx_system_profile_by_session_cache?.delete(sessionId);
        g.__fx_system_profile_by_session_inflight?.delete(sessionId);
      });
    }

    const res = json({ ok: true });
    const cookieDomain = String(process.env.SYSTEM_COOKIE_DOMAIN || "").trim() || undefined;

    const clearCookie = {
      name: "fxlocus_session_id",
      value: "",
      path: "/",
      maxAge: 0
    } as const;
    res.cookies.set(clearCookie);
    if (cookieDomain) {
      res.cookies.set({ ...clearCookie, domain: cookieDomain });
    }
    return res;
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "LOGOUT_FAILED" }, 500);
  }
}

