import { NextResponse } from "next/server";

import { canConsultWith } from "@/lib/system/consult";
import { mapSystemApiError } from "@/lib/system/apiError";
import { requireSystemUser } from "@/lib/system/guard";
import { dbAll, dbFirst, dbRun, sqlPlaceholders } from "@/lib/d1";
import { invalidateConsultCache } from "@/lib/system/cacheInvalidation";
import { isMissingSchemaError } from "@/lib/system/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

const MESSAGE_FIELD_SETS = [
  "id, from_user_id, to_user_id, content_type, content_text, image_bucket, image_path, image_name, image_mime_type, image_size_bytes, audio_duration_sec, created_at, read_at, reply_to_message_id",
  "id, from_user_id, to_user_id, content_type, content_text, image_bucket, image_path, image_name, image_mime_type, image_size_bytes, created_at, read_at",
  "id, from_user_id, to_user_id, content_type, content_text, created_at, read_at",
  "id, from_user_id, to_user_id, content_text, created_at, read_at"
];
const REPLY_FIELD_SETS = [
  "id, from_user_id, to_user_id, content_type, content_text, image_name, created_at",
  "id, from_user_id, to_user_id, content_text, created_at"
];

function buildConversationSql(fields: string, includeSince: boolean) {
  const retentionClause = " and created_at >= ?";
  const sinceClause = includeSince ? " and created_at >= ?" : "";
  return [
    "select * from (",
    "select * from (",
    `select ${fields} from consult_messages where from_user_id = ? and to_user_id = ?${retentionClause}${sinceClause}`,
    "union all",
    `select ${fields} from consult_messages where from_user_id = ? and to_user_id = ?${retentionClause}${sinceClause}`,
    ") as convo",
    "order by created_at desc, id desc limit ?",
    ") as latest",
    "order by created_at asc, id asc"
  ].join(" ");
}

export async function GET(req: Request) {
  try {
    const ctx = await requireSystemUser();
    const { searchParams } = new URL(req.url);
    const peerId = String(searchParams.get("peerId") || "").trim();
    const since = String(searchParams.get("since") || "").trim();
    const limitRaw = Number(searchParams.get("limit") || 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    if (!peerId || peerId.length > 128) return json({ ok: false, error: "INVALID_PEER" }, 400);

    const allowed = await canConsultWith(ctx, peerId);
    if (!allowed) return json({ ok: false, error: "FORBIDDEN" }, 403);

    const params: unknown[] = [ctx.user.id, peerId, cutoff];
    if (since) params.push(since);
    params.push(peerId, ctx.user.id, cutoff);
    if (since) params.push(since);
    params.push(limit);

    let data: any[] = [];
    for (const fields of MESSAGE_FIELD_SETS) {
      try {
        const sql = buildConversationSql(fields, Boolean(since));
        data = await dbAll(sql, params);
        break;
      } catch (err) {
        if (!isMissingSchemaError(err)) throw err;
      }
    }

    const replyIds = Array.from(
      new Set((data || []).map((row: any) => String(row?.reply_to_message_id || "").trim()).filter(Boolean))
    );
    let replyRows: any[] = [];
    if (replyIds.length) {
      for (const fields of REPLY_FIELD_SETS) {
        try {
          replyRows = await dbAll(
            `select ${fields} from consult_messages where id in (${sqlPlaceholders(replyIds.length)})`,
            replyIds
          );
          break;
        } catch (err) {
          if (!isMissingSchemaError(err)) throw err;
        }
      }
    }
    const replyById = new Map(
      (replyRows || []).map((row: any) => [
        String(row?.id || ""),
        {
          id: row.id,
          from_user_id: row.from_user_id,
          to_user_id: row.to_user_id,
          content_type: row.content_type || (row.content_text ? "text" : "unknown"),
          content_text: row.content_text || null,
          image_name: row.image_name || null,
          created_at: row.created_at
        }
      ])
    );

    const items = await Promise.all(
      (data || []).map(async (row: any) => {
        let imageUrl: string | null = null;
        if (row.image_bucket && row.image_path) {
          const params = new URLSearchParams({
            bucket: String(row.image_bucket),
            path: String(row.image_path),
            disposition: "inline",
            mode: "proxy"
          });
          if (row.image_name) params.set("name", String(row.image_name));
          if (row.image_mime_type) params.set("mimeType", String(row.image_mime_type));
          imageUrl = `/api/system/storage/proxy?${params.toString()}`;
        }
        const contentType =
          row.content_type ||
          (row.image_bucket && row.image_path ? "image" : row.content_text ? "text" : "text");
        const replyToMessageId = String(row?.reply_to_message_id || "").trim() || null;
        const replyTo = replyToMessageId ? replyById.get(replyToMessageId) || null : null;
        return {
          id: row.id,
          from_user_id: row.from_user_id,
          to_user_id: row.to_user_id,
          content_type: contentType,
          content_text: row.content_text,
          image_url: imageUrl,
          image_name: row.image_name,
          image_mime_type: row.image_mime_type,
          image_size_bytes: row.image_size_bytes,
          audio_duration_sec: row.audio_duration_sec,
          reply_to_message_id: replyToMessageId,
          reply_to: replyTo,
          created_at: row.created_at,
          read_at: row.read_at
        };
      })
    );

    const hasUnreadInPayload = (data || []).some((row: any) => {
      const toUserId = String(row?.to_user_id || "");
      const readAt = row?.read_at ?? null;
      return toUserId === ctx.user.id && !readAt;
    });
    let shouldMarkRead = hasUnreadInPayload;
    if (!shouldMarkRead && !since) {
      const unreadRow = await dbFirst<{ id: string | null }>(
        "select id from consult_messages where to_user_id = ? and from_user_id = ? and created_at >= ? and read_at is null limit 1",
        [ctx.user.id, peerId, cutoff]
      );
      shouldMarkRead = Boolean(unreadRow?.id);
    }
    if (shouldMarkRead) {
      await dbRun(
        "update consult_messages set read_at = ? where to_user_id = ? and from_user_id = ? and created_at >= ? and read_at is null",
        [new Date().toISOString(), ctx.user.id, peerId, cutoff]
      );
      invalidateConsultCache();
    }

    return json({ ok: true, items });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
