import { dbAll, dbFirst, dbRun, sqlPlaceholders } from "@/lib/d1";

let ensured = false;

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function parseMaybeJson(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function pickNonEmptyText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function resolveAdminRecordReadAt(
  row: { read_at?: unknown; payload?: unknown; content?: unknown } | null | undefined,
  readMark?: string | null
) {
  const direct = pickNonEmptyText(row?.read_at);
  if (direct) return direct;

  const normalizedMark = pickNonEmptyText(readMark);
  if (normalizedMark) return normalizedMark;

  const payload = parseMaybeJson(row?.payload);
  const content = parseMaybeJson(row?.content);
  return (
    pickNonEmptyText(payload?.read_at) ||
    pickNonEmptyText(payload?.readAt) ||
    pickNonEmptyText(content?.read_at) ||
    pickNonEmptyText(content?.readAt) ||
    null
  );
}

export async function ensureAdminRecordReadMarksTable() {
  if (ensured) return;
  await dbRun(
    [
      "create table if not exists admin_record_read_marks (",
      "record_type text not null,",
      "record_id text not null,",
      "read_at text not null,",
      "updated_at text not null default (CURRENT_TIMESTAMP),",
      "primary key (record_type, record_id)",
      ")"
    ].join(" ")
  );
  await dbRun(
    "create index if not exists admin_record_read_marks_type_idx on admin_record_read_marks (record_type, updated_at desc)"
  );
  ensured = true;
}

export async function upsertAdminRecordReadMark(recordType: string, recordId: string, readAt: string) {
  const type = normalize(recordType);
  const id = String(recordId || "").trim();
  if (!type || !id || !readAt) return;
  await ensureAdminRecordReadMarksTable();
  await dbRun(
    [
      "insert into admin_record_read_marks (record_type, record_id, read_at, updated_at)",
      "values (?, ?, ?, ?)",
      "on conflict(record_type, record_id)",
      "do update set read_at = excluded.read_at, updated_at = excluded.updated_at"
    ].join(" "),
    [type, id, readAt, readAt]
  );
}

export async function getAdminRecordReadMarkMap(recordType: string, recordIds: string[]) {
  const ids = Array.from(
    new Set(
      (recordIds || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );
  const map = new Map<string, string>();
  if (!ids.length) return map;
  await ensureAdminRecordReadMarksTable();
  const rows = await dbAll<{ record_id: string; read_at: string }>(
    [
      "select record_id, read_at",
      "from admin_record_read_marks",
      `where record_type = ? and record_id in (${sqlPlaceholders(ids.length)}) and read_at is not null`
    ].join(" "),
    [normalize(recordType), ...ids]
  );
  for (const row of rows || []) {
    const id = String(row.record_id || "").trim();
    const readAt = String(row.read_at || "").trim();
    if (id && readAt) map.set(id, readAt);
  }
  return map;
}

export async function countUnreadContactSubmissionsByReadMarks() {
  await ensureAdminRecordReadMarksTable();
  const row = await dbFirst<{ total: number }>(
    [
      "select count(1) as total",
      "from contact_submissions c",
      "left join admin_record_read_marks m",
      "on m.record_type = ? and m.record_id = c.id",
      "where m.read_at is null"
    ].join(" "),
    ["contact"]
  );
  return Number(row?.total || 0);
}
