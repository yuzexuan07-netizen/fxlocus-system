import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin, requireSuperAdmin } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { LADDER_IMAGE_URL, LADDER_REFRESH_MS } from "@/lib/system/ladderConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  imageUrl: z.string().url(),
  refreshMs: z.number().int().min(1000).max(300000).optional()
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    await requireAdmin();
    const admin = dbAdmin();
    const { data, error } = await admin.from("ladder_config").select("id,image_url,refresh_ms,updated_at").eq("id", 1).maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    const imageUrl = data?.image_url || LADDER_IMAGE_URL;
    const refreshMs = Number(data?.refresh_ms || LADDER_REFRESH_MS);
    return json({
      ok: true,
      config: { imageUrl, refreshMs, updatedAt: data?.updated_at || null }
    });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const admin = dbAdmin();
    const payload = {
      id: 1,
      image_url: parsed.data.imageUrl,
      refresh_ms: parsed.data.refreshMs ?? LADDER_REFRESH_MS,
      updated_at: new Date().toISOString()
    };

    const up = await admin.from("ladder_config").upsert(payload as any, { onConflict: "id" }).select("id").maybeSingle();
    if (up.error) return json({ ok: false, error: up.error.message }, 500);

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
