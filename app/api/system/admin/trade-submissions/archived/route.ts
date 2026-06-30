import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { requireManager } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { buildSqlInFilter, dbAll, sqlPlaceholders } from "@/lib/d1";
import { mapSystemApiError } from "@/lib/system/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TypeParam = z.enum(["all", "trade_log", "trade_strategy"]);

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireManager();
    const typeRaw = req.nextUrl.searchParams.get("type") || "all";
    const parsedType = TypeParam.safeParse(typeRaw);
    if (!parsedType.success) return json({ ok: false, error: "INVALID_TYPE" }, 400);
    const type = parsedType.data;
    const keyword = (req.nextUrl.searchParams.get("q") || "").trim();

    let scopeIds: string[] | null = null;
    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      scopeIds = treeIds;
      if (!treeIds.length) return json({ ok: true, items: [] });
    } else if (user.role === "coach") {
      const assignedIds = await fetchCoachAssignedUserIds(user.id);
      scopeIds = assignedIds;
      if (!assignedIds.length) return json({ ok: true, items: [] });
    } else if (user.role === "assistant") {
      const createdIds = await fetchAssistantCreatedUserIds(user.id);
      scopeIds = createdIds;
      if (!createdIds.length) return json({ ok: true, items: [] });
    }

    let filterIds: string[] | null = null;
    if (keyword) {
      const like = `%${keyword.toLowerCase()}%`;
      const where: string[] = [];
      const params: unknown[] = [];
      if (scopeIds) {
        const scopedProfilesFilter = buildSqlInFilter("id", scopeIds);
        if (scopedProfilesFilter.sql) {
          where.push(scopedProfilesFilter.sql);
          params.push(...scopedProfilesFilter.params);
        }
      }
      where.push("(lower(full_name) like ? or lower(email) like ? or lower(phone) like ?)");
      params.push(like, like, like);

      const profiles = await dbAll<{ id: string }>(
        `select id from profiles where ${where.join(" and ")} and role in ('student','trader','coach','deleted_student') limit 200`,
        params
      );
      filterIds = (profiles || []).map((p) => p.id).filter(Boolean);
      if (!filterIds.length) return json({ ok: true, items: [] });
    }

    const where: string[] = ["archived_at is not null"];
    const params: unknown[] = [];
    if (type !== "all") {
      where.push("type = ?");
      params.push(type);
    }
    if (scopeIds) {
      const scopedFilter = buildSqlInFilter("user_id", scopeIds);
      if (scopedFilter.sql) {
        where.push(scopedFilter.sql);
        params.push(...scopedFilter.params);
      }
    }
    if (filterIds) {
      where.push(`user_id in (${sqlPlaceholders(filterIds.length)})`);
      params.push(...filterIds);
    }

    const submissions = await dbAll(
      `select id,user_id,type,status,review_note,created_at,archived_at from trade_submissions where ${where.join(
        " and "
      )} order by archived_at desc limit 200`,
      params
    );

    const ids = (submissions || []).map((s: any) => s.id);
    const files = ids.length
      ? await dbAll(
          `select id,submission_id,file_name,mime_type,size_bytes,storage_bucket,storage_path from trade_submission_files where submission_id in (${sqlPlaceholders(
            ids.length
          )})`,
          ids
        )
      : [];

    const filesBySubmission = new Map<string, any[]>();
    (files || []).forEach((f: any) => {
      const list = filesBySubmission.get(f.submission_id) || [];
      list.push(f);
      filesBySubmission.set(f.submission_id, list);
    });

    const userIds = Array.from(new Set((submissions || []).map((s: any) => s.user_id).filter(Boolean)));
    const users = userIds.length
      ? await dbAll(
          `select id,full_name,email,phone from profiles where id in (${sqlPlaceholders(userIds.length)})`,
          userIds
        )
      : [];
    const usersById = new Map((users || []).map((u: any) => [u.id, u]));

    const items = (submissions || []).map((s: any) => {
      const list = filesBySubmission.get(s.id) || [];
      const nextFiles = list.map((f) => ({
        id: f.id,
        file_name: f.file_name,
        mime_type: f.mime_type || null,
        size_bytes: f.size_bytes || 0,
        url: f.id ? `/api/system/trade-submission-files/${f.id}/download?disposition=inline` : null
      }));
      return {
        ...s,
        user: usersById.get(s.user_id) || null,
        files: nextFiles
      };
    });

    return json({ ok: true, items });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}
