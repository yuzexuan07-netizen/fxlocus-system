import { NextRequest, NextResponse } from "next/server";

import { dbAll, dbRun } from "@/lib/d1";
import { requireSuperAdmin } from "@/lib/system/guard";
import {
  getR2Bucket,
  r2CopyObject,
  r2DeleteObjects,
  r2ListKeys,
  r2ObjectExists
} from "@/lib/storage/r2";
import { buildStoragePathCandidates, normalizeStorageBucket, normalizeStoragePath } from "@/lib/storage/path";
import { isKnownStorageBucketName } from "@/lib/storage/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUDENT_DOC_PREFIX = "student-documents/";
const LADDER_PREFIX = "ladder/";
const CONSULT_IMAGE_PREFIX = "consult/images/";
const MUSIC_TRACK_PREFIX = "music/tracks/";
const STUDENT_DOC_LEGACY_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(enrollment_form|trial_screenshot|verification_image)\//i;
const MUSIC_AUDIO_RE = /^music\/(?!tracks\/).+\.(mp3|wav|ogg|m4a|aac)$/i;

type LegacyStorageRow = {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function toPositiveInt(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withPrefix(path: string, prefix: string) {
  const normalized = normalizeStoragePath(path);
  if (!normalized) return "";
  return normalized.startsWith(prefix) ? normalized : `${prefix}${normalized}`;
}

async function migrateRows(input: {
  rows: LegacyStorageRow[];
  table: "student_documents" | "ladder_snapshots" | "consult_messages";
  prefix: string;
}) {
  const { rows, table, prefix } = input;
  const summary = {
    scanned: 0,
    updated: 0,
    copied: 0,
    deletedOld: 0,
    skipped: 0,
    missing: 0,
    errors: [] as string[]
  };
  const pathColumn = table === "consult_messages" ? "image_path" : "storage_path";

  for (const row of rows) {
    summary.scanned += 1;
    const bucket = normalizeStorageBucket(row.storage_bucket);
    const oldPath = normalizeStoragePath(row.storage_path);
    const nextPath = withPrefix(oldPath, prefix);
    if (!bucket || !oldPath || !nextPath || oldPath === nextPath) {
      summary.skipped += 1;
      continue;
    }
    if (!isKnownStorageBucketName(bucket)) {
      summary.skipped += 1;
      continue;
    }

    try {
      const oldExists = await r2ObjectExists(oldPath);
      const nextExists = await r2ObjectExists(nextPath);
      if (!oldExists && !nextExists) {
        summary.missing += 1;
        continue;
      }

      if (!nextExists && oldExists) {
        await r2CopyObject(oldPath, nextPath);
        summary.copied += 1;
      }

      await dbRun(`update ${table} set ${pathColumn} = ? where id = ?`, [nextPath, row.id]);
      summary.updated += 1;

      if (oldExists) {
        await r2DeleteObjects([oldPath]);
        summary.deletedOld += 1;
      }
    } catch (error: any) {
      summary.errors.push(`${table}:${row.id}:${String(error?.message || error || "UNKNOWN")}`);
    }
  }

  return summary;
}

async function sweepLegacyStudentDocKeys(limit: number) {
  const keys = await r2ListKeys("", limit);
  const summary = {
    scanned: 0,
    copied: 0,
    deletedOld: 0,
    skipped: 0,
    errors: [] as string[]
  };

  for (const key of keys) {
    if (!STUDENT_DOC_LEGACY_RE.test(key)) continue;
    summary.scanned += 1;
    const nextPath = `${STUDENT_DOC_PREFIX}${normalizeStoragePath(key)}`;
    if (!nextPath || nextPath === key) {
      summary.skipped += 1;
      continue;
    }
    try {
      const nextExists = await r2ObjectExists(nextPath);
      if (!nextExists) {
        await r2CopyObject(key, nextPath);
        summary.copied += 1;
      }
      await r2DeleteObjects([key]);
      summary.deletedOld += 1;
    } catch (error: any) {
      summary.errors.push(`${key}:${String(error?.message || error || "UNKNOWN")}`);
    }
  }

  return summary;
}

async function migrateConsultImageRows(limit: number) {
  const rows = await dbAll<LegacyStorageRow>(
    "select id, image_bucket as storage_bucket, image_path as storage_path from consult_messages where image_path is not null and image_path <> '' and image_path like ? and image_path not like ? limit ?",
    ["consult/%", `${CONSULT_IMAGE_PREFIX}%`, limit]
  ).catch(() => [] as LegacyStorageRow[]);

  return migrateRows({ rows, table: "consult_messages", prefix: CONSULT_IMAGE_PREFIX });
}

async function sweepLegacyMusicKeys(limit: number) {
  const keys = await r2ListKeys("music/", limit);
  const summary = {
    scanned: 0,
    copied: 0,
    deletedOld: 0,
    skipped: 0,
    errors: [] as string[]
  };

  for (const key of keys) {
    if (!MUSIC_AUDIO_RE.test(key)) continue;
    summary.scanned += 1;
    const normalized = normalizeStoragePath(key);
    const relative = normalized.replace(/^music\//i, "");
    const nextPath = `${MUSIC_TRACK_PREFIX}${relative}`;
    if (!relative || !nextPath || nextPath === normalized) {
      summary.skipped += 1;
      continue;
    }
    try {
      const nextExists = await r2ObjectExists(nextPath);
      if (!nextExists) {
        await r2CopyObject(normalized, nextPath);
        summary.copied += 1;
      }
      await r2DeleteObjects([normalized]);
      summary.deletedOld += 1;
    } catch (error: any) {
      summary.errors.push(`${normalized}:${String(error?.message || error || "UNKNOWN")}`);
    }
  }

  return summary;
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin();

    const body = await req.json().catch(() => null);
    const limit = toPositiveInt(body?.limit, 5000);
    const r2Bucket = getR2Bucket();
    const [studentRows, ladderRows] = await Promise.all([
      dbAll<LegacyStorageRow>(
        "select id, storage_bucket, storage_path from student_documents where storage_path is not null and storage_path <> '' and storage_path not like ? limit ?",
        [`${STUDENT_DOC_PREFIX}%`, limit]
      ),
      dbAll<LegacyStorageRow>(
        "select id, storage_bucket, storage_path from ladder_snapshots where storage_path is not null and storage_path <> '' and storage_path not like ? limit ?",
        [`${LADDER_PREFIX}%`, limit]
      ).catch(() => [] as LegacyStorageRow[])
    ]);

    const [studentDocs, ladder, consultImages, studentDocSweep, musicSweep] = await Promise.all([
      migrateRows({ rows: studentRows, table: "student_documents", prefix: STUDENT_DOC_PREFIX }),
      migrateRows({ rows: ladderRows, table: "ladder_snapshots", prefix: LADDER_PREFIX }),
      migrateConsultImageRows(limit),
      sweepLegacyStudentDocKeys(limit),
      sweepLegacyMusicKeys(limit)
    ]);

    const sampleCandidates = buildStoragePathCandidates("9b6a9fc8-b9e2-414b-8075-96911478dc0b/enrollment_form/a.docx");

    return json({
      ok: true,
      bucket: r2Bucket,
      studentDocs,
      ladder,
      consultImages,
      studentDocSweep,
      musicSweep,
      sampleCandidates
    });
  } catch (error: any) {
    const code = String(error?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
