import { NextResponse } from "next/server";
import { z } from "zod";

import { POST as hardDeletePost } from "../hard-delete/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().trim().min(1).max(128)
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

// Backward-compatible alias:
// legacy "delete" now executes full hard-delete cleanup to avoid half-deleted accounts.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

  const forward = new Request(req.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: parsed.data.userId, confirm: "HARD_DELETE" })
  });
  return hardDeletePost(forward);
}
