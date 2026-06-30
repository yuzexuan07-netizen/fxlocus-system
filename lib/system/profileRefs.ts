import "server-only";

import { dbAll, dbFirst, sqlPlaceholders } from "@/lib/d1";

function normalizeProfileId(value: string | null | undefined) {
  const id = String(value || "").trim();
  return id || null;
}

export async function resolveExistingProfileId(
  value: string | null | undefined
): Promise<string | null> {
  const id = normalizeProfileId(value);
  if (!id) return null;
  const row = await dbFirst<{ id: string }>("select id from profiles where id = ? limit 1", [id]);
  return row?.id || null;
}

export async function filterExistingProfileIds(values: Array<string | null | undefined>) {
  const ids = Array.from(new Set(values.map((value) => normalizeProfileId(value)).filter(Boolean))) as string[];
  if (!ids.length) return [] as string[];
  const rows = await dbAll<{ id: string }>(
    `select id from profiles where id in (${sqlPlaceholders(ids.length)})`,
    ids
  );
  const existing = new Set((rows || []).map((row) => String(row.id || "")));
  return ids.filter((id) => existing.has(id));
}

