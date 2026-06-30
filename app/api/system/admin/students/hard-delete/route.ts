import { NextResponse } from "next/server";
import { z } from "zod";

import { dbAll, dbFirst, dbRun } from "@/lib/d1";
import { requireManager } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { removeStoredObjects } from "@/lib/storage/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().trim().min(1).max(128),
  confirm: z.literal("HARD_DELETE")
});

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function isMissingSchemaError(err: any) {
  const message = String(err?.message || "").toLowerCase();
  return message.includes("no such table") || message.includes("no such column");
}

function normalizeStorageRow(row: { bucket?: string | null; path?: string | null }) {
  const bucket = String(row?.bucket || "").trim();
  const path = String(row?.path || "").trim();
  if (!bucket || !path) return null;
  return { bucket, path };
}

async function collectUserStorageItems(userId: string) {
  const items = new Map<string, { bucket: string; path: string }>();
  const pushItem = (bucket: string | null | undefined, path: string | null | undefined) => {
    const normalized = normalizeStorageRow({ bucket, path });
    if (!normalized) return;
    items.set(`${normalized.bucket}::${normalized.path}`, normalized);
  };

  const loaders: Array<() => Promise<void>> = [
    async () => {
      const rows = await dbAll<{ image_bucket: string | null; image_path: string | null }>(
        "select image_bucket, image_path from consult_messages where from_user_id = ? or to_user_id = ?",
        [userId, userId]
      );
      rows.forEach((row) => pushItem(row.image_bucket, row.image_path));
    },
    async () => {
      const rows = await dbAll<{ image_bucket: string | null; image_path: string | null }>(
        "select image_bucket, image_path from classic_trades where user_id = ?",
        [userId]
      );
      rows.forEach((row) => pushItem(row.image_bucket, row.image_path));
    },
    async () => {
      const rows = await dbAll<{
        strategy_bucket: string | null;
        strategy_path: string | null;
        curve_bucket: string | null;
        curve_path: string | null;
        stats_bucket: string | null;
        stats_path: string | null;
      }>(
        "select strategy_bucket, strategy_path, curve_bucket, curve_path, stats_bucket, stats_path from weekly_summaries where user_id = ?",
        [userId]
      );
      rows.forEach((row) => {
        pushItem(row.strategy_bucket, row.strategy_path);
        pushItem(row.curve_bucket, row.curve_path);
        pushItem(row.stats_bucket, row.stats_path);
      });
    },
    async () => {
      const rows = await dbAll<{ storage_bucket: string | null; storage_path: string | null }>(
        "select storage_bucket, storage_path from student_documents where student_id = ?",
        [userId]
      );
      rows.forEach((row) => pushItem(row.storage_bucket, row.storage_path));
    },
    async () => {
      const rows = await dbAll<{ storage_bucket: string | null; storage_path: string | null }>(
        [
          "select tsf.storage_bucket, tsf.storage_path",
          "from trade_submission_files tsf",
          "join trade_submissions ts on ts.id = tsf.submission_id",
          "where ts.user_id = ? and (ts.type <> 'trade_strategy' or ts.archived_at is null)"
        ].join(" "),
        [userId]
      );
      rows.forEach((row) => pushItem(row.storage_bucket, row.storage_path));
    }
  ];

  for (const load of loaders) {
    try {
      await load();
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }
  }

  return Array.from(items.values());
}

async function cleanupProfileDependencies(userId: string, email: string | null) {
  const updateNullTargets: Array<{ table: string; column: string }> = [
    { table: "course_access", column: "reviewed_by" },
    { table: "course_group_access", column: "reviewed_by" },
    { table: "course_notes", column: "reviewed_by" },
    { table: "file_permissions", column: "granted_by" },
    { table: "file_access_requests", column: "reviewed_by" },
    { table: "trade_submissions", column: "reviewed_by" },
    { table: "trade_submissions", column: "archived_by" },
    { table: "classic_trades", column: "reviewed_by" },
    { table: "weekly_summaries", column: "reviewed_by" },
    { table: "ladder_authorizations", column: "reviewed_by" },
    { table: "ladder_snapshots", column: "created_by" },
    { table: "files", column: "uploaded_by" },
    { table: "student_documents", column: "reviewed_by" }
  ];

  for (const item of updateNullTargets) {
    try {
      await dbRun(`update ${item.table} set ${item.column} = null where ${item.column} = ?`, [userId]);
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }
  }

  const deleteTargets: Array<{ table: string; column: string }> = [
    { table: "coach_assignments", column: "assigned_user_id" },
    { table: "coach_assignments", column: "coach_id" },
    { table: "coach_assignments", column: "assigned_by" },
    { table: "role_audit_logs", column: "target_id" },
    { table: "role_audit_logs", column: "actor_id" },
    { table: "ladder_authorizations", column: "user_id" },
    { table: "student_documents", column: "student_id" },
    { table: "consult_messages", column: "from_user_id" },
    { table: "consult_messages", column: "to_user_id" },
    { table: "notifications", column: "to_user_id" },
    { table: "notifications", column: "from_user_id" },
    { table: "file_download_logs", column: "user_id" },
    { table: "file_access_requests", column: "user_id" },
    { table: "file_permissions", column: "grantee_profile_id" },
    { table: "course_access", column: "user_id" },
    { table: "course_group_access", column: "user_id" },
    { table: "course_notes", column: "user_id" },
    { table: "classic_trades", column: "user_id" },
    { table: "weekly_summaries", column: "user_id" }
  ];

  for (const item of deleteTargets) {
    try {
      await dbRun(`delete from ${item.table} where ${item.column} = ?`, [userId]);
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }
  }

  // Keep archived trade strategies for manual deletion; remove all other submission rows.
  try {
    await dbRun(
      "delete from trade_submissions where user_id = ? and (type <> ? or archived_at is null)",
      [userId, "trade_strategy"]
    );
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;

  let recordIds: string[] = [];
  try {
    const rows = await dbAll<{ id: string | null }>(
      "select id from records where lower(email) = ?",
      [normalizedEmail]
    );
    recordIds = (rows || []).map((row) => String(row.id || "")).filter(Boolean);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }

  try {
    await dbRun("delete from records where lower(email) = ?", [normalizedEmail]);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }

  if (recordIds.length) {
    for (const recordId of recordIds) {
      try {
        await dbRun("delete from admin_record_read_marks where record_id = ?", [recordId]);
      } catch (err) {
        if (!isMissingSchemaError(err)) throw err;
      }
    }
  }

  try {
    await dbRun("delete from contact_submissions where lower(email) = ?", [normalizedEmail]);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }

  try {
    await dbRun("delete from donation_applications where lower(email) = ?", [normalizedEmail]);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireManager();
    const role = ctx.user.role;
    if (role !== "super_admin" && role !== "leader") {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);
    const userId = parsed.data.userId;

    const target = await dbFirst<{ id: string; role: string | null; email: string | null; full_name: string | null }>(
      "select id, role, email, full_name from profiles where id = ? limit 1",
      [userId]
    );
    if (!target?.id) return json({ ok: false, error: "NOT_FOUND" }, 404);

    const learnerRoles = ["student", "trader", "coach"];
    if (!learnerRoles.includes(String(target.role || ""))) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    if (role === "leader") {
      const treeIds = await fetchLeaderTreeIds(ctx.user.id);
      if (!treeIds.includes(userId)) return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const storageItems = await collectUserStorageItems(userId);

    await cleanupProfileDependencies(userId, target.email ?? null);

    const now = new Date().toISOString();
    const tombstoneEmail = `deleted+${userId}@deleted.local`;
    const originalName = String(target.full_name || "").trim();
    const tombstoneName = originalName ? `[Deleted] ${originalName}` : "Deleted User";

    try {
      await dbRun("delete from local_auth_users where user_id = ?", [userId]);
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }

    await dbRun(
      [
        "update profiles",
        "set email = ?,",
        "    full_name = ?,",
        "    phone = null,",
        "    role = ?,",
        "    status = ?,",
        "    student_status = ?,",
        "    session_id = null,",
        "    updated_at = ?",
        "where id = ?"
      ].join(" "),
      [tombstoneEmail, tombstoneName, "deleted_student", "deleted", "deleted", now, userId]
    );

    if (storageItems.length) {
      try {
        const admin = dbAdmin();
        await removeStoredObjects(admin, storageItems);
      } catch {
        // tolerate storage cleanup failures to avoid blocking account deletion
      }
    }

    try {
      const admin = dbAdmin();
      const { error: authErr } = await admin.auth.admin.deleteUser(userId);
      if (authErr && !String(authErr.message || "").toLowerCase().includes("not found")) {
        return json({ ok: false, error: authErr.message }, 500);
      }
    } catch {
      // ignore auth provider cleanup failures; local profile is already tombstoned
    }

    return json({ ok: true });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
