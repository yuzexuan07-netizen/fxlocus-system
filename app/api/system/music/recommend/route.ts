import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function disabled() {
  return json({ ok: false, error: "MUSIC_PROVIDER_DISABLED" }, 410);
}

export async function GET() {
  return disabled();
}

export async function POST() {
  return disabled();
}
