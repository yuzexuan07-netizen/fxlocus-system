import { NextResponse } from "next/server";

import { mapSystemApiError } from "@/lib/system/apiError";
import { requireSystemUser } from "@/lib/system/guard";
import { getWeeklyTodayData } from "@/lib/system/todayData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, max-age=15, stale-while-revalidate=30"
    }
  });
}

export async function GET(request: Request) {
  try {
    await requireSystemUser();
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const data = await getWeeklyTodayData(new Date(), undefined, { fresh });
    return json({ ok: true, ...data });
  } catch (error: any) {
    const mapped = mapSystemApiError(error, "UPSTREAM_FAILED");
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
