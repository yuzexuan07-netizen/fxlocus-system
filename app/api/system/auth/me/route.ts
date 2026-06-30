import { NextResponse } from "next/server";

import { getSystemAuth } from "@/lib/system/auth";

export const runtime = "nodejs";

export async function GET() {
  const res = await getSystemAuth();
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}

