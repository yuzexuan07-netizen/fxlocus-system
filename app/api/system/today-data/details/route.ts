import { NextResponse } from "next/server";

import { mapSystemApiError } from "@/lib/system/apiError";
import { requireSystemUser } from "@/lib/system/guard";
import { getEconomicDetailPatches } from "@/lib/system/todayData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DETAIL_IDS_PER_REQUEST = 18;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, max-age=30, stale-while-revalidate=60"
    }
  });
}

export async function POST(request: Request) {
  try {
    await requireSystemUser();
    const body = (await request.json().catch(() => null)) as {
      ids?: unknown;
      fresh?: unknown;
    } | null;

    const ids = Array.isArray(body?.ids)
      ? body!.ids
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .slice(0, MAX_DETAIL_IDS_PER_REQUEST)
      : [];

    if (!ids.length) {
      return json({ ok: true, data: {} });
    }

    const fresh = body?.fresh === true || body?.fresh === "1";
    const patches = await getEconomicDetailPatches(ids, { fresh });
    return json({ ok: true, data: Object.fromEntries(patches) });
  } catch (error: any) {
    const mapped = mapSystemApiError(error, "UPSTREAM_FAILED");
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
