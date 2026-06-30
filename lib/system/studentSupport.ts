import { dbAll, sqlPlaceholders, type D1Row } from "@/lib/d1";

export type StudentSupportInfo = {
  assistantName: string | null;
  coachName: string | null;
  leaderName: string | null;
  displayName: string | null;
};

const IN_CLAUSE_CHUNK_SIZE = 80;

function formatName(row: any) {
  if (!row) return null;
  const name = String(row.full_name || "").trim();
  if (name) return name;
  const email = String(row.email || "").trim();
  if (email) return email;
  const id = String(row.id || "").trim();
  return id ? id.slice(0, 6) : null;
}

function isMissingSchemaError(err: any) {
  const message = String(err?.message || "").toLowerCase();
  return message.includes("no such table") || message.includes("no such column");
}

function isUsableSupportStatus(status: unknown) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return true;
  return normalized !== "deleted" && normalized !== "frozen";
}

async function safeDbAll<T extends D1Row>(sql: string, params: unknown[]) {
  try {
    return await dbAll<T>(sql, params);
  } catch (err) {
    if (isMissingSchemaError(err)) return [] as T[];
    throw err;
  }
}

function chunkValues<T>(values: T[], size = IN_CLAUSE_CHUNK_SIZE) {
  const normalizedSize = Math.max(1, Number(size) || IN_CLAUSE_CHUNK_SIZE);
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += normalizedSize) {
    chunks.push(values.slice(index, index + normalizedSize));
  }
  return chunks;
}

type StudentRow = {
  id: string;
  created_by: string | null;
  leader_id: string | null;
  source?: string | null;
};

type SupportProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
  leader_id?: string | null;
};

async function queryStudentRowsByIds(ids: string[]) {
  if (!ids.length) return [] as StudentRow[];
  const sqlVariants = [
    `select id, created_by, leader_id, source from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, created_by, leader_id, null as source from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, created_by, null as leader_id, source from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, created_by, null as leader_id, null as source from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, null as created_by, leader_id, source from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, null as created_by, leader_id, null as source from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, null as created_by, null as leader_id, source from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, null as created_by, null as leader_id, null as source from profiles where id in (${sqlPlaceholders(ids.length)})`
  ];
  for (const sql of sqlVariants) {
    try {
      return await dbAll<StudentRow>(sql, ids);
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }
  }
  return [] as StudentRow[];
}

async function querySupportProfilesByIds(ids: string[]) {
  if (!ids.length) return [] as SupportProfileRow[];
  const sqlVariants = [
    `select id, full_name, email, role, status, leader_id from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, full_name, email, role, null as status, leader_id from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, full_name, email, role, status, null as leader_id from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, full_name, email, role, null as status, null as leader_id from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, email, role, null as status, null as leader_id, null as full_name from profiles where id in (${sqlPlaceholders(ids.length)})`,
    `select id, null as email, role, null as status, null as leader_id, null as full_name from profiles where id in (${sqlPlaceholders(ids.length)})`
  ];
  for (const sql of sqlVariants) {
    try {
      return await dbAll<SupportProfileRow>(sql, ids);
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }
  }
  return [] as SupportProfileRow[];
}

export async function fetchStudentSupportNames(
  studentIds: string[]
): Promise<Map<string, StudentSupportInfo>> {
  const uniqueIds = Array.from(new Set(studentIds.filter(Boolean)));
  const result = new Map<string, StudentSupportInfo>();
  if (!uniqueIds.length) return result;
  try {
    const students: StudentRow[] = [];
    for (const chunk of chunkValues(uniqueIds)) {
      const rows = await queryStudentRowsByIds(chunk);
      if (rows.length) students.push(...rows);
    }

    const coachAssignments: Array<{ assigned_user_id: string | null; coach_id: string | null }> = [];
    for (const chunk of chunkValues(uniqueIds)) {
      const rows = await safeDbAll<{ assigned_user_id: string | null; coach_id: string | null }>(
        `select assigned_user_id, coach_id from coach_assignments where assigned_user_id in (${sqlPlaceholders(chunk.length)})`,
        chunk
      );
      if (rows.length) coachAssignments.push(...rows);
    }

    const coachByStudent = new Map<string, string>();
    coachAssignments.forEach((row) => {
      const studentId = String(row.assigned_user_id || "");
      const coachId = String(row.coach_id || "");
      if (studentId && coachId && !coachByStudent.has(studentId)) coachByStudent.set(studentId, coachId);
    });

    const createdByIds = Array.from(
      new Set(students.map((row) => String(row.created_by || "")).filter(Boolean))
    );
    const leaderIds = Array.from(
      new Set(students.map((row) => String(row.leader_id || "")).filter(Boolean))
    );
    const coachIds = Array.from(new Set(Array.from(coachByStudent.values()).filter(Boolean)));
    const supportIds = Array.from(new Set([...createdByIds, ...leaderIds, ...coachIds]));

    const supportProfiles: SupportProfileRow[] = [];
    for (const chunk of chunkValues(supportIds)) {
      const rows = await querySupportProfilesByIds(chunk);
      if (rows.length) supportProfiles.push(...rows);
    }

    const profileById = new Map<string, { label: string; role: string; status: string }>();
    supportProfiles.forEach((row) => {
      const id = String(row.id || "");
      const label = formatName(row);
      if (!id || !label) return;
      profileById.set(id, {
        label,
        role: String(row.role || "").trim().toLowerCase(),
        status: String(row.status || "").trim().toLowerCase()
      });
    });

    students.forEach((row) => {
      const studentId = String(row.id || "");
      if (!studentId) return;
      const leaderId = String(row.leader_id || "");
      const leaderProfile = leaderId ? profileById.get(leaderId) || null : null;
      const leaderName =
        leaderProfile && isUsableSupportStatus(leaderProfile.status)
          ? leaderProfile.label || null
          : null;
      const creatorId = String(row.created_by || "");
      const creatorProfile = creatorId ? profileById.get(creatorId) || null : null;
      // Business rule:
      // 1. If the student's creator is still an active assistant, use that assistant.
      // 2. If the creator was deleted or no longer has assistant role, fall back to leader.
      // 3. UI-facing support label prefers coach over the effective assistant.
      const directAssistantName =
        creatorProfile &&
        creatorProfile.role === "assistant" &&
        isUsableSupportStatus(creatorProfile.status)
          ? creatorProfile.label || null
          : null;
      const assistantName = directAssistantName || leaderName || null;
      const coachId = coachByStudent.get(studentId);
      const coachProfile = coachId ? profileById.get(coachId || "") || null : null;
      const coachName =
        coachProfile && isUsableSupportStatus(coachProfile.status)
          ? coachProfile.label || null
          : null;
      const displayName = coachName || assistantName || null;
      result.set(studentId, {
        assistantName,
        leaderName,
        coachName,
        displayName
      });
    });

    const missingIds = uniqueIds.filter((studentId) => !result.has(studentId));
    missingIds.forEach((studentId) => {
      result.set(studentId, {
        assistantName: null,
        coachName: null,
        leaderName: null,
        displayName: null
      });
    });
  } catch {
    uniqueIds.forEach((studentId) => {
      result.set(studentId, {
        assistantName: null,
        coachName: null,
        leaderName: null,
        displayName: null
      });
    });
  }

  return result;
}
