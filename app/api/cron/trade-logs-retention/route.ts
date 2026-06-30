import { NextRequest, NextResponse } from "next/server";

import { dbAll, dbRun, sqlPlaceholders } from "@/lib/d1";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { acquireJobLock, releaseJobLock } from "@/lib/system/jobLock";
import { removeStoredObjects } from "@/lib/storage/storage";

export const runtime = "nodejs";

const JOB_NAME = "cron_trade_logs_retention";
const LOCK_SECONDS = 900;

async function cleanupTradeLogs(days = 30) {
  const admin = dbAdmin();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let deleted = 0;
  let removedFiles = 0;
  let loops = 0;

  while (loops < 20) {
    loops += 1;
    const submissions = await dbAll<{ id: string }>(
      "select id from trade_submissions where type = ? and created_at < ? limit 200",
      ["trade_log", cutoff]
    );
    if (!submissions.length) break;

    const ids = submissions.map((row: any) => row.id);
    const files = await dbAll<{ storage_bucket: string | null; storage_path: string | null }>(
      `select storage_bucket, storage_path from trade_submission_files where submission_id in (${sqlPlaceholders(ids.length)})`,
      ids
    );

    const stored = (files || [])
      .filter((file: any) => file?.storage_bucket && file?.storage_path)
      .map((file: any) => ({ bucket: file.storage_bucket as string, path: file.storage_path as string }));
    if (stored.length) {
      await removeStoredObjects(admin, stored);
      removedFiles += stored.length;
    }

    await dbRun(`delete from trade_submissions where id in (${sqlPlaceholders(ids.length)})`, ids);
    deleted += ids.length;

    if (submissions.length < 200) break;
  }

  return { deleted, removedFiles, cutoff };
}

async function cleanupTradeStrategies(days = 30) {
  const admin = dbAdmin();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let deleted = 0;
  let removedFiles = 0;
  let loops = 0;

  while (loops < 20) {
    loops += 1;
    // Keep archived strategies permanently; retention only clears unarchived stale drafts/rejected items.
    const submissions = await dbAll<{ id: string }>(
      "select id from trade_submissions where type = ? and archived_at is null and created_at < ? limit 200",
      ["trade_strategy", cutoff]
    );
    if (!submissions.length) break;

    const candidateIds = submissions.map((row: any) => row.id);
    const files = await dbAll<{
      submission_id: string;
      storage_bucket: string | null;
      storage_path: string | null;
    }>(
      `select f.submission_id, f.storage_bucket, f.storage_path
       from trade_submission_files f
       inner join trade_submissions s on s.id = f.submission_id
       where f.submission_id in (${sqlPlaceholders(candidateIds.length)})
         and s.type = ?
         and s.archived_at is null`,
      [...candidateIds, "trade_strategy"]
    );

    // Delete first and only clean object storage for rows actually deleted in this batch.
    const deletedRows = await dbAll<{ id: string }>(
      `delete from trade_submissions
       where id in (${sqlPlaceholders(candidateIds.length)})
         and type = ?
         and archived_at is null
       returning id`,
      [...candidateIds, "trade_strategy"]
    );
    const deletedIds = new Set((deletedRows || []).map((row: any) => String(row.id)));
    deleted += deletedIds.size;

    if (deletedIds.size) {
      const stored = (files || [])
        .filter(
          (file: any) =>
            deletedIds.has(String(file?.submission_id || "")) &&
            file?.storage_bucket &&
            file?.storage_path
        )
        .map((file: any) => ({ bucket: file.storage_bucket as string, path: file.storage_path as string }));
      if (stored.length) {
        await removeStoredObjects(admin, stored);
        removedFiles += stored.length;
      }
    }

    if (submissions.length < 200) break;
  }

  return { deleted, removedFiles, cutoff };
}

async function cleanupWeeklySummaries(days = 30) {
  const admin = dbAdmin();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let deleted = 0;
  let removedFiles = 0;
  let loops = 0;

  while (loops < 20) {
    loops += 1;
    const rows = await dbAll<{
      id: string;
      strategy_bucket: string | null;
      strategy_path: string | null;
      curve_bucket: string | null;
      curve_path: string | null;
      stats_bucket: string | null;
      stats_path: string | null;
    }>(
      "select id, strategy_bucket, strategy_path, curve_bucket, curve_path, stats_bucket, stats_path from weekly_summaries where created_at < ? limit 200",
      [cutoff]
    );
    if (!rows.length) break;

    const stored = (rows || [])
      .flatMap((row: any) => [
        row?.strategy_bucket && row?.strategy_path
          ? { bucket: String(row.strategy_bucket), path: String(row.strategy_path) }
          : null,
        row?.curve_bucket && row?.curve_path
          ? { bucket: String(row.curve_bucket), path: String(row.curve_path) }
          : null,
        row?.stats_bucket && row?.stats_path
          ? { bucket: String(row.stats_bucket), path: String(row.stats_path) }
          : null
      ])
      .filter(Boolean) as Array<{ bucket: string; path: string }>;

    if (stored.length) {
      await removeStoredObjects(admin, stored);
      removedFiles += stored.length;
    }

    const ids = rows.map((row: any) => row.id);
    await dbRun(`delete from weekly_summaries where id in (${sqlPlaceholders(ids.length)})`, ids);
    deleted += ids.length;

    if (rows.length < 200) break;
  }

  return { deleted, removedFiles, cutoff };
}

async function cleanupClassicTrades(days = 30) {
  const admin = dbAdmin();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let deleted = 0;
  let removedFiles = 0;
  let loops = 0;

  while (loops < 20) {
    loops += 1;
    const rows = await dbAll<{ id: string; image_bucket: string | null; image_path: string | null }>(
      "select id, image_bucket, image_path from classic_trades where created_at < ? limit 200",
      [cutoff]
    );
    if (!rows.length) break;

    const stored = (rows || [])
      .filter((row: any) => row?.image_bucket && row?.image_path)
      .map((row: any) => ({ bucket: String(row.image_bucket), path: String(row.image_path) }));
    if (stored.length) {
      await removeStoredObjects(admin, stored);
      removedFiles += stored.length;
    }

    const ids = rows.map((row: any) => row.id);
    await dbRun(`delete from classic_trades where id in (${sqlPlaceholders(ids.length)})`, ids);
    deleted += ids.length;

    if (rows.length < 200) break;
  }

  return { deleted, removedFiles, cutoff };
}

async function handle(_req: NextRequest, secret: string | null) {
  const configuredSecret = process.env.TRADE_LOG_RETENTION_SECRET;
  if (configuredSecret && (!secret || secret !== configuredSecret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const lock = await acquireJobLock(JOB_NAME, LOCK_SECONDS);
  if (!lock.ok) {
    return NextResponse.json({ ok: false, error: lock.error }, { status: 202 });
  }

  try {
    const [tradeLogs, tradeStrategies, weeklySummaries, classicTrades] = await Promise.all([
      cleanupTradeLogs(30),
      cleanupTradeStrategies(30),
      cleanupWeeklySummaries(30),
      cleanupClassicTrades(30)
    ]);
    const result = { tradeLogs, tradeStrategies, weeklySummaries, classicTrades };
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
