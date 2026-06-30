import { NextRequest, NextResponse } from "next/server";

import { dbAll, dbRun, sqlPlaceholders } from "@/lib/d1";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { acquireJobLock, releaseJobLock } from "@/lib/system/jobLock";
import { removeStoredObjects } from "@/lib/storage/storage";

export const runtime = "nodejs";

const JOB_NAME = "cron_consult_retention";
const LOCK_SECONDS = 900;

async function cleanupConsult() {
  const admin = dbAdmin();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let deleted = 0;
  let removedFiles = 0;
  let loops = 0;

  while (loops < 20) {
    loops += 1;
    const rows = await dbAll<{ id: string; image_bucket: string | null; image_path: string | null }>(
      "select id, image_bucket, image_path from consult_messages where created_at < ? limit 200",
      [cutoff]
    );
    if (!rows.length) break;

    const stored = rows
      .filter((row: any) => row?.image_bucket && row?.image_path)
      .map((row: any) => ({ bucket: row.image_bucket as string, path: row.image_path as string }));
    if (stored.length) {
      await removeStoredObjects(admin, stored);
      removedFiles += stored.length;
    }

    const ids = rows.map((row: any) => row.id);
    await dbRun(
      `delete from consult_messages where id in (${sqlPlaceholders(ids.length)})`,
      ids
    );
    deleted += ids.length;

    if (rows.length < 200) break;
  }

  return { deleted, removedFiles, cutoff };
}

async function handle(_req: NextRequest, secret: string | null) {
  const configuredSecret =
    process.env.CONSULT_RETENTION_SECRET ||
    process.env.SYSTEM_RETENTION_SECRET ||
    process.env.TRADE_LOG_RETENTION_SECRET ||
    null;
  if (configuredSecret && (!secret || secret !== configuredSecret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const lock = await acquireJobLock(JOB_NAME, LOCK_SECONDS);
  if (!lock.ok) {
    return NextResponse.json({ ok: false, error: lock.error }, { status: 202 });
  }

  try {
    const result = await cleanupConsult();
    await releaseJobLock(JOB_NAME);
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    await releaseJobLock(JOB_NAME, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  return handle(req, secret);
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  return handle(req, secret);
}
