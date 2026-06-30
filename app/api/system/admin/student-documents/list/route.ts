import { NextRequest, NextResponse } from "next/server";

import { requireManager } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { buildSqlInFilter, dbAll, dbFirst, sqlPlaceholders } from "@/lib/d1";
import { getPagination } from "@/lib/system/pagination";
import { buildStorageProxyUrl } from "@/lib/storage/objectUrl";
import { mapSystemApiError } from "@/lib/system/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_TTL_MS = 8_000;
const CACHE_MAX_KEYS = 2000;
type StudentDocumentsPayload = {
  ok: true;
  items: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
  warning?: string;
};
const g = globalThis as {
  __fx_admin_student_documents_cache?: Map<string, { exp: number; payload: StudentDocumentsPayload }>;
  __fx_admin_student_documents_inflight?: Map<string, Promise<StudentDocumentsPayload>>;
};
if (!g.__fx_admin_student_documents_cache) g.__fx_admin_student_documents_cache = new Map();
if (!g.__fx_admin_student_documents_inflight) g.__fx_admin_student_documents_inflight = new Map();
const studentDocumentsCache = g.__fx_admin_student_documents_cache;
const studentDocumentsInflight = g.__fx_admin_student_documents_inflight;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function isMissingSchemaError(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("no such table") || message.includes("no such column") || message.includes("schema cache");
}

function sweepStudentDocumentsCache(now: number) {
  if (!studentDocumentsCache.size) return;
  for (const [key, value] of studentDocumentsCache.entries()) {
    if (value.exp <= now) studentDocumentsCache.delete(key);
  }
  if (studentDocumentsCache.size <= CACHE_MAX_KEYS) return;
  const overflow = studentDocumentsCache.size - CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of studentDocumentsCache.keys()) {
    studentDocumentsCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function docDedupeKey(doc: {
  student_id?: string | null;
  doc_type?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
}) {
  return [
    String(doc.student_id || "").trim(),
    String(doc.doc_type || "").trim(),
    String(doc.file_name || "").trim().toLowerCase(),
    String(doc.mime_type || "").trim().toLowerCase(),
    String(doc.size_bytes || 0)
  ].join("|");
}

async function loadStudentDocumentsPayload(input: {
  page: number;
  pageSize: number;
  from: number;
  scopedIds: string[] | null;
  studentId: string;
  keyword: string;
}): Promise<StudentDocumentsPayload> {
  const { page, pageSize, from, scopedIds, studentId, keyword } = input;
  if (scopedIds && !scopedIds.length) {
    return { ok: true, items: [], page, pageSize, total: 0 };
  }

  const where: string[] = [];
  const whereParams: unknown[] = [];
  if (scopedIds) {
    const scopedFilter = buildSqlInFilter("d.student_id", scopedIds);
    if (scopedFilter.sql) {
      where.push(scopedFilter.sql);
      whereParams.push(...scopedFilter.params);
    }
  }
  if (studentId) {
    where.push("d.student_id = ?");
    whereParams.push(studentId);
  }
  if (keyword) {
    const like = `%${keyword}%`;
    where.push(
      [
        "(",
        "exists (",
        "  select 1 from profiles p",
        "  where p.id = d.student_id",
        "    and (lower(coalesce(p.full_name, '')) like ? or lower(coalesce(p.email, '')) like ?)",
        ")",
        "or exists (",
        "  select 1 from student_documents ds",
        "  where ds.student_id = d.student_id",
        "    and lower(coalesce(ds.file_name, '')) like ?",
        ")",
        ")"
      ].join(" ")
    );
    whereParams.push(like, like, like);
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  let includeReviewColumns = true;
  let studentKeyRows: any[] | null = null;
  try {
    studentKeyRows = await dbAll(
      [
        "select d.student_id,",
        "case when sum(case when d.reviewed_at is null then 1 else 0 end) > 0 then 0 else 1 end as __review_rank,",
        "max(d.created_at) as __latest_at,",
        "count(1) over() as __total",
        "from student_documents d",
        whereSql,
        "group by d.student_id",
        "order by __review_rank asc, __latest_at desc",
        "limit ? offset ?"
      ].join(" "),
      [...whereParams, pageSize, from]
    );
  } catch (error: any) {
    if (!isMissingSchemaError(error)) throw error;
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("no such table")) {
      return { ok: true, items: [], warning: "student_documents_missing", page, pageSize, total: 0 };
    }
    includeReviewColumns = false;
    studentKeyRows = await dbAll(
      [
        "select d.student_id,",
        "max(d.created_at) as __latest_at,",
        "count(1) over() as __total",
        "from student_documents d",
        whereSql,
        "group by d.student_id",
        "order by __latest_at desc",
        "limit ? offset ?"
      ].join(" "),
      [...whereParams, pageSize, from]
    ).catch((fallbackError: any) => {
      if (isMissingSchemaError(fallbackError)) return null;
      throw fallbackError;
    });
    if (studentKeyRows === null) {
      return { ok: true, items: [], warning: "student_documents_missing", page, pageSize, total: 0 };
    }
  }

  let total = Number((studentKeyRows || [])[0]?.__total || 0);
  if (!studentKeyRows?.length && from > 0) {
    const totalRow = await dbFirst<{ total: number }>(
      [
        "select count(1) as total",
        "from (",
        "select d.student_id",
        "from student_documents d",
        whereSql,
        "group by d.student_id",
        ") t"
      ].join(" "),
      whereParams
    ).catch((error: any) => {
      if (isMissingSchemaError(error)) return null;
      throw error;
    });
    if (totalRow === null) {
      return { ok: true, items: [], warning: "student_documents_missing", page, pageSize, total: 0 };
    }
    total = Number(totalRow?.total || 0);
  }
  if (!total) {
    return { ok: true, items: [], page, pageSize, total: 0 };
  }

  const pageStudentIds = Array.from(
    new Set((studentKeyRows || []).map((row) => String(row.student_id || "")).filter(Boolean))
  );
  if (!pageStudentIds.length) {
    return { ok: true, items: [], page, pageSize, total };
  }

  const baseFields =
    "id,student_id,doc_type,file_name,mime_type,size_bytes,created_at,storage_bucket,storage_path";
  const reviewFields = `${baseFields},reviewed_at,reviewed_by`;

  const studentPromise = dbAll(
    [
      "select id,full_name,email,student_status,status,leader_id",
      "from profiles",
      `where id in (${sqlPlaceholders(pageStudentIds.length)})`
    ].join(" "),
    pageStudentIds
  );

  const docsPromise = includeReviewColumns
    ? dbAll(
        [
          `select ${reviewFields}`,
          "from student_documents",
          `where student_id in (${sqlPlaceholders(pageStudentIds.length)})`,
          "order by created_at desc"
        ].join(" "),
        pageStudentIds
      ).catch(async (error: any) => {
        if (!isMissingSchemaError(error)) throw error;
        const fallbackRows = await dbAll(
          [
            `select ${baseFields}`,
            "from student_documents",
            `where student_id in (${sqlPlaceholders(pageStudentIds.length)})`,
            "order by created_at desc"
          ].join(" "),
          pageStudentIds
        );
        includeReviewColumns = false;
        return fallbackRows.map((row: any) => ({ ...row, reviewed_at: null, reviewed_by: null }));
      })
    : dbAll(
        [
          `select ${baseFields}`,
          "from student_documents",
          `where student_id in (${sqlPlaceholders(pageStudentIds.length)})`,
          "order by created_at desc"
        ].join(" "),
        pageStudentIds
      ).then((rows: any[]) => rows.map((row: any) => ({ ...row, reviewed_at: null, reviewed_by: null })));

  const [docRows, students] = await Promise.all([docsPromise, studentPromise]);

  const studentById = new Map((students || []).map((row: any) => [String(row.id || ""), row]));
  const docs = (docRows || []).map((row: any) => {
    const url =
      row.storage_bucket && row.storage_path
        ? buildStorageProxyUrl(row.storage_bucket, row.storage_path, {
            filename: row.file_name,
            contentType: row.mime_type
          })
        : null;
    return {
      id: row.id,
      student_id: row.student_id,
      doc_type: row.doc_type,
      file_name: row.file_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
      reviewed_at: row.reviewed_at,
      reviewed_by: row.reviewed_by,
      url,
      student: studentById.get(String(row.student_id || "")) || null
    };
  });

  const grouped = new Map<
    string,
    {
      student_id: string;
      student: any;
      docs: {
        enrollment_form?: any;
        trial_screenshot?: any;
        verification_image: any[];
      };
      latest_at: string | null;
      reviewed: boolean;
    }
  >();

  const seenDocKeys = new Set<string>();
  docs.forEach((doc) => {
    const key = docDedupeKey(doc);
    if (seenDocKeys.has(key)) return;
    seenDocKeys.add(key);
    const currentStudentId = String(doc.student_id || "");
    if (!currentStudentId) return;
    let entry = grouped.get(currentStudentId);
    if (!entry) {
      entry = {
        student_id: currentStudentId,
        student: doc.student || null,
        docs: { verification_image: [] },
        latest_at: doc.created_at || null,
        reviewed: true
      };
      grouped.set(currentStudentId, entry);
    }
    if (doc.doc_type === "verification_image") {
      entry.docs.verification_image.push(doc);
    } else if (doc.doc_type === "enrollment_form") {
      if (!entry.docs.enrollment_form) entry.docs.enrollment_form = doc;
    } else if (doc.doc_type === "trial_screenshot") {
      if (!entry.docs.trial_screenshot) entry.docs.trial_screenshot = doc;
    }

    if (doc.created_at) {
      const current = entry.latest_at ? new Date(entry.latest_at).getTime() : 0;
      const candidate = new Date(doc.created_at).getTime();
      if (!current || candidate > current) entry.latest_at = doc.created_at;
    }

    if (!doc.reviewed_at) entry.reviewed = false;
  });

  const items = Array.from(grouped.values()).sort((a, b) => {
    if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1;
    const aTime = a.latest_at ? new Date(a.latest_at).getTime() : 0;
    const bTime = b.latest_at ? new Date(b.latest_at).getTime() : 0;
    return bTime - aTime;
  });

  return { ok: true, items, page, pageSize, total };
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireManager();
    const { page, pageSize, from } = getPagination(req, { defaultPageSize: 20, maxPageSize: 100 });
    const studentId = String(req.nextUrl.searchParams.get("studentId") || "").trim();
    const keyword = String(req.nextUrl.searchParams.get("keyword") || "").trim().toLowerCase();
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";

    let scopedIds: string[] | null = null;
    if (user.role === "leader") {
      scopedIds = await fetchLeaderTreeIds(user.id);
    } else if (user.role === "coach") {
      scopedIds = await fetchCoachAssignedUserIds(user.id);
    } else if (user.role === "assistant") {
      scopedIds = await fetchAssistantCreatedUserIds(user.id);
    } else if (user.role === "super_admin") {
      scopedIds = null;
    } else {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    if (studentId && scopedIds && !scopedIds.includes(studentId)) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const cacheKey = `${user.id}:${user.role}:${page}:${pageSize}:${from}:${studentId}:${keyword}`;
    if (!fresh) {
      const now = Date.now();
      sweepStudentDocumentsCache(now);
      const cached = studentDocumentsCache.get(cacheKey);
      if (cached && cached.exp > now) {
        return json(cached.payload);
      }
    }

    let task: Promise<StudentDocumentsPayload> | undefined = fresh
      ? undefined
      : studentDocumentsInflight.get(cacheKey);
    if (!task) {
      task = loadStudentDocumentsPayload({ page, pageSize, from, scopedIds, studentId, keyword });
      if (!fresh) studentDocumentsInflight.set(cacheKey, task);
    }
    try {
      const payload = await task;
      if (!fresh) {
        studentDocumentsCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, payload });
      }
      return json(payload);
    } finally {
      if (!fresh) studentDocumentsInflight.delete(cacheKey);
    }
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}



