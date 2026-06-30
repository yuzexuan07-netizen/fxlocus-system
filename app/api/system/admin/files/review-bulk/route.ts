import { NextResponse } from "next/server";
import { z } from "zod";

import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { requireSystemUser } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { dbAll, dbBatch, dbRun, sqlPlaceholders } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";
import { invalidateFileRequestsCache, invalidateSidebarCountsCache } from "@/lib/system/cacheInvalidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    items: z
      .array(
        z
          .object({
            userId: z.string().trim().min(1).max(128).optional(),
            user_id: z.string().trim().min(1).max(128).optional(),
            fileId: z.string().trim().min(1).max(128).optional(),
            file_id: z.string().trim().min(1).max(128).optional()
          })
          .transform((item) => ({
            userId: String(item.userId || item.user_id || "").trim(),
            fileId: String(item.fileId || item.file_id || "").trim()
          }))
      )
      .min(1),
    action: z.enum(["approve", "reject"]),
    reason: z.string().max(500).optional()
  })
  .superRefine((payload, ctx) => {
    payload.items.forEach((item, index) => {
      if (!item.userId || !item.fileId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "INVALID_ITEM",
          path: ["items", index]
        });
      }
    });
  });

const REJECTION_REASONS = [
  "\u8d44\u6599\u4e0d\u5b8c\u6574",
  "\u4e0d\u7b26\u5408\u8981\u6c42",
  "\u540d\u989d\u5df2\u6ee1",
  "\u91cd\u590d\u7533\u8bf7",
  "\u5176\u4ed6"
] as const;
type RejectionReason = (typeof REJECTION_REASONS)[number];

function normalizeRejectionReason(input: unknown): RejectionReason {
  const value = String(input || "").trim();
  return (REJECTION_REASONS as readonly string[]).includes(value)
    ? (value as RejectionReason)
    : "\u5176\u4ed6";
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const { user } = await requireSystemUser();
    if (!(user.role === "super_admin" || user.role === "leader" || user.role === "assistant")) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return json({ ok: false, error: "INVALID_BODY" }, 400);

    const now = new Date().toISOString();
    const status = parsed.data.action === "approve" ? "approved" : "rejected";
    const rejectionReason = status === "rejected" ? normalizeRejectionReason(parsed.data.reason) : null;

    const unique = new Map<string, { userId: string; fileId: string }>();
    for (const it of parsed.data.items) unique.set(`${it.userId}:${it.fileId}`, it);
    const items = Array.from(unique.values());

    const scopeIds =
      user.role === "leader"
        ? await fetchLeaderTreeIds(user.id)
        : user.role === "assistant"
          ? await fetchAssistantCreatedUserIds(user.id)
          : null;
    if (scopeIds) {
      const scopeSet = new Set(scopeIds);
      const outOfScope = items.filter((it) => !scopeSet.has(it.userId));
      if (outOfScope.length) return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    if (status === "approved") {
      const perms = items.map((it) => ({
        sql: "insert or ignore into file_permissions (file_id, grantee_profile_id, granted_by, created_at) values (?, ?, ?, ?)",
        params: [it.fileId, it.userId, user.id, now]
      }));
      if (perms.length) await dbBatch(perms);
    }

    const updates = items.map((it) => ({
      sql: "update file_access_requests set status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = ? where user_id = ? and file_id = ?",
      params: [status, now, user.id, rejectionReason, it.userId, it.fileId]
    }));
    if (updates.length) await dbBatch(updates);

    const fileIds = Array.from(new Set(items.map((it) => it.fileId)));
    const files = fileIds.length
      ? await dbAll(
          `select id, name, category from files where id in (${sqlPlaceholders(fileIds.length)})`,
          fileIds
        )
      : [];
    const fileById = new Map((files || []).map((f: any) => [f.id, f]));

    const notifications = items.map((it) => {
      const f = fileById.get(it.fileId);
      const label = f ? `${f.category || ""} ${f.name || ""}`.trim() : it.fileId;
      return {
        sql: "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
        params: [
          it.userId,
          user.id,
          status === "approved" ? "File access approved" : "File access rejected",
          status === "approved"
            ? `Your file access request has been approved: ${label}`
            : `Your file access request was rejected: ${label}\nReason: ${rejectionReason}`,
          now
        ]
      };
    });
    if (notifications.length) await dbBatch(notifications);

    invalidateFileRequestsCache();
    invalidateSidebarCountsCache();

    return json({ ok: true });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}

