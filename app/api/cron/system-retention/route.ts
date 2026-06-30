import { NextRequest, NextResponse } from "next/server";

import { dbAll, dbRun, sqlPlaceholders } from "@/lib/d1";
import { acquireJobLock, releaseJobLock } from "@/lib/system/jobLock";
import { isMissingSchemaError } from "@/lib/system/schema";
import { STUDENT_STATUS_NORMAL } from "@/lib/system/studentStatusValues";

export const runtime = "nodejs";

const JOB_NAME = "cron_system_retention";
const LOCK_SECONDS = 900;
const BATCH_SIZE = 300;
const MAX_LOOPS = 40;

type DeleteBatchResult = {
  deleted: number;
  cutoff: string;
  skipped?: boolean;
};

type IdRow = { id: string };
type FreezeInactiveStudentsResult = {
  frozen: number;
  checked: number;
  cutoff: string;
  missingRequiredFiles?: string[];
  skipped?: boolean;
};
type FileRow = { id: string; name: string | null; category: string | null; description: string | null };

const ONBOARDING_FILE_SPECS = [
  {
    key: "stage-one",
    keywords: ["\u7b2c\u4e00\u9636\u6bb5", "stage1", "stage 1", "phase1", "phase 1"]
  },
  {
    key: "mt4",
    keywords: ["mt4\u8f6f\u4ef6\u64cd\u4f5c", "mt4\u64cd\u4f5c", "mt4\u4f7f\u7528", "mt4\u6559\u7a0b", "software guide"]
  },
  {
    key: "portable",
    keywords: ["\u7eff\u8272\u514d\u5b89\u88c5", "\u514d\u5b89\u88c5", "\u7eff\u8272\u7248", "portable"]
  },
  {
    key: "enrollment-form",
    keywords: ["\u62a5\u540d\u8868", "\u62a5\u540d", "enrollment form"]
  }
] as const;

function cutoffIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function safeDbAll<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  try {
    return await dbAll<T>(sql, params);
  } catch (error) {
    if (isMissingSchemaError(error)) return [] as T[];
    throw error;
  }
}

async function safeDbRun(sql: string, params: unknown[] = []) {
  try {
    return await dbRun(sql, params);
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

async function cleanupByIdTable(table: string, whereSql: string, params: unknown[], days: number): Promise<DeleteBatchResult> {
  const cutoff = cutoffIso(days);
  let deleted = 0;
  let loops = 0;

  while (loops < MAX_LOOPS) {
    loops += 1;
    const rows = await safeDbAll<IdRow>(
      `select id from ${table} where ${whereSql} and created_at < ? limit ${BATCH_SIZE}`,
      [...params, cutoff]
    );
    if (!rows.length) break;

    const ids = rows.map((row) => row.id).filter(Boolean);
    if (!ids.length) break;
    const delResult = await safeDbRun(
      `delete from ${table} where id in (${sqlPlaceholders(ids.length)})`,
      ids
    );
    deleted += Number((delResult as any)?.meta?.changes ?? (delResult as any)?.changes ?? ids.length);
    if (rows.length < BATCH_SIZE) break;
  }

  return { deleted, cutoff };
}

async function cleanupReadNotifications(days = 90): Promise<DeleteBatchResult> {
  const cutoff = cutoffIso(days);
  let deleted = 0;
  let loops = 0;

  while (loops < MAX_LOOPS) {
    loops += 1;
    const rows = await safeDbAll<IdRow>(
      `select id from notifications where read_at is not null and created_at < ? limit ${BATCH_SIZE}`,
      [cutoff]
    );
    if (!rows.length) break;
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (!ids.length) break;
    const delResult = await safeDbRun(
      `delete from notifications where id in (${sqlPlaceholders(ids.length)})`,
      ids
    );
    deleted += Number((delResult as any)?.meta?.changes ?? (delResult as any)?.changes ?? ids.length);
    if (rows.length < BATCH_SIZE) break;
  }

  return { deleted, cutoff };
}

async function cleanupRecordsAndReadMarks(days = 180): Promise<DeleteBatchResult> {
  const cutoff = cutoffIso(days);
  let deleted = 0;
  let loops = 0;
  let skipped = false;

  while (loops < MAX_LOOPS) {
    loops += 1;
    const rows = await safeDbAll<IdRow>(
      `select id from records where created_at < ? limit ${BATCH_SIZE}`,
      [cutoff]
    );
    if (!rows.length) break;
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (!ids.length) break;

    const marksResult = await safeDbRun(
      `delete from admin_record_read_marks where record_id in (${sqlPlaceholders(ids.length)})`,
      ids
    );
    if (marksResult === null) skipped = true;

    const delResult = await safeDbRun(
      `delete from records where id in (${sqlPlaceholders(ids.length)})`,
      ids
    );
    deleted += Number((delResult as any)?.meta?.changes ?? (delResult as any)?.changes ?? ids.length);
    if (rows.length < BATCH_SIZE) break;
  }

  return { deleted, cutoff, skipped: skipped || undefined };
}

async function cleanupFileDownloadLogs(days = 90): Promise<DeleteBatchResult> {
  const cutoff = cutoffIso(days);
  let deleted = 0;
  let loops = 0;

  while (loops < MAX_LOOPS) {
    loops += 1;
    const rows = await safeDbAll<IdRow>(
      `select id from file_download_logs where downloaded_at < ? limit ${BATCH_SIZE}`,
      [cutoff]
    );
    if (!rows.length) break;
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (!ids.length) break;
    const delResult = await safeDbRun(
      `delete from file_download_logs where id in (${sqlPlaceholders(ids.length)})`,
      ids
    );
    deleted += Number((delResult as any)?.meta?.changes ?? (delResult as any)?.changes ?? ids.length);
    if (rows.length < BATCH_SIZE) break;
  }

  return { deleted, cutoff };
}

async function cleanupJobRuns(days = 365): Promise<DeleteBatchResult> {
  const cutoff = cutoffIso(days);
  const result = await safeDbRun(
    "delete from job_runs where running = 0 and coalesce(last_finished_at, last_started_at, '') <> '' and coalesce(last_finished_at, last_started_at, '') < ?",
    [cutoff]
  );
  return {
      deleted: Number((result as any)?.meta?.changes ?? (result as any)?.changes ?? 0),
    cutoff,
    skipped: result === null || undefined
  };
}

function normalizeSearchText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function getOnboardingFileMatches(files: FileRow[]) {
  const bySpec = new Map<string, string[]>();
  for (const spec of ONBOARDING_FILE_SPECS) bySpec.set(spec.key, []);

  for (const file of files) {
    const text = normalizeSearchText([file.category, file.name, file.description].filter(Boolean).join(" "));
    if (!text) continue;
    for (const spec of ONBOARDING_FILE_SPECS) {
      if (spec.keywords.some((keyword) => text.includes(normalizeSearchText(keyword)))) {
        bySpec.get(spec.key)?.push(String(file.id));
      }
    }
  }

  return bySpec;
}

async function queryUsersWithRequiredFileAction(
  userIds: string[],
  fileIdsBySpec: Map<string, string[]>
) {
  const fileKeyById = new Map<string, string>();
  for (const [key, ids] of fileIdsBySpec.entries()) {
    ids.forEach((id) => fileKeyById.set(id, key));
  }
  const fileIds = Array.from(fileKeyById.keys());
  const completedByUser = new Map<string, Set<string>>();
  if (!userIds.length || !fileIds.length) return completedByUser;

  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const chunk = userIds.slice(i, i + BATCH_SIZE);
    for (let j = 0; j < fileIds.length; j += 500) {
      const fileChunk = fileIds.slice(j, j + 500);
      const requestRows = await safeDbAll<{ user_id: string | null; file_id: string | null }>(
        [
          "select user_id, file_id from file_access_requests",
          `where user_id in (${sqlPlaceholders(chunk.length)})`,
          `and file_id in (${sqlPlaceholders(fileChunk.length)})`
        ].join(" "),
        [...chunk, ...fileChunk]
      );
      const permissionRows = await safeDbAll<{ user_id: string | null; file_id: string | null }>(
        [
          "select grantee_profile_id as user_id, file_id from file_permissions",
          `where grantee_profile_id in (${sqlPlaceholders(chunk.length)})`,
          `and file_id in (${sqlPlaceholders(fileChunk.length)})`
        ].join(" "),
        [...chunk, ...fileChunk]
      );

      for (const row of [...requestRows, ...permissionRows]) {
        const userId = String(row.user_id || "").trim();
        const key = fileKeyById.get(String(row.file_id || "").trim());
        if (!userId || !key) continue;
        const set = completedByUser.get(userId) || new Set<string>();
        set.add(key);
        completedByUser.set(userId, set);
      }
    }
  }

  return completedByUser;
}

async function freezeInactiveTrialStudents(days = 3): Promise<FreezeInactiveStudentsResult> {
  const cutoff = cutoffIso(days);
  const candidates = await safeDbAll<IdRow>(
    [
      "select id from profiles",
      "where role = 'student'",
      "and status = 'active'",
      "and coalesce(student_status, ?) = ?",
      "and created_at < ?",
      `order by created_at asc limit ${BATCH_SIZE * MAX_LOOPS}`
    ].join(" "),
    [STUDENT_STATUS_NORMAL, STUDENT_STATUS_NORMAL, cutoff]
  );
  const candidateIds = (candidates || []).map((row) => String(row.id || "").trim()).filter(Boolean);
  if (!candidateIds.length) return { frozen: 0, checked: 0, cutoff };

  const fileRows = await safeDbAll<FileRow>(
    [
      "select id, name, category, description from files",
      "where course_id is null and lesson_id is null"
    ].join(" ")
  );
  const fileIdsBySpec = getOnboardingFileMatches(fileRows || []);
  const missingRequiredFiles = ONBOARDING_FILE_SPECS
    .filter((spec) => !(fileIdsBySpec.get(spec.key) || []).length)
    .map((spec) => spec.key);

  if (missingRequiredFiles.length) {
    return { frozen: 0, checked: candidateIds.length, cutoff, missingRequiredFiles, skipped: true };
  }

  const completedByUser = await queryUsersWithRequiredFileAction(candidateIds, fileIdsBySpec);
  const requiredCount = ONBOARDING_FILE_SPECS.length;
  const freezeIds = candidateIds.filter((id) => (completedByUser.get(id)?.size || 0) < requiredCount);
  if (!freezeIds.length) return { frozen: 0, checked: candidateIds.length, cutoff };

  const now = new Date().toISOString();
  let frozen = 0;
  let skipped = false;
  for (let i = 0; i < freezeIds.length; i += BATCH_SIZE) {
    const chunk = freezeIds.slice(i, i + BATCH_SIZE);
    let result = await safeDbRun(
      `update profiles set status = 'frozen', session_id = null, updated_at = ? where id in (${sqlPlaceholders(
        chunk.length
      )}) and status = 'active'`,
      [now, ...chunk]
    );
    if (result === null) {
      skipped = true;
      result = await safeDbRun(
        `update profiles set status = 'frozen', updated_at = ? where id in (${sqlPlaceholders(
          chunk.length
        )}) and status = 'active'`,
        [now, ...chunk]
      );
    }
    frozen += Number((result as any)?.meta?.changes ?? (result as any)?.changes ?? 0);
  }

  return { frozen, checked: candidateIds.length, cutoff, skipped: skipped || undefined };
}

async function handle(_req: NextRequest, secret: string | null) {
  const configuredSecret =
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
    const [
      notifications,
      records,
      contactSubmissions,
      donationApplications,
      fileDownloadLogs,
      roleAuditLogs,
      jobRuns,
      inactiveTrialStudents
    ] = await Promise.all([
      cleanupReadNotifications(90),
      cleanupRecordsAndReadMarks(180),
      cleanupByIdTable("contact_submissions", "1=1", [], 365),
      cleanupByIdTable("donation_applications", "1=1", [], 365),
      cleanupFileDownloadLogs(90),
      cleanupByIdTable("role_audit_logs", "1=1", [], 730),
      cleanupJobRuns(365),
      freezeInactiveTrialStudents(3)
    ]);

    const result = {
      notifications,
      records,
      contactSubmissions,
      donationApplications,
      fileDownloadLogs,
      roleAuditLogs,
      jobRuns,
      inactiveTrialStudents
    };
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
