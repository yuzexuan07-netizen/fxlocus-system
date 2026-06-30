import "server-only";

import { dbAll, dbBatch } from "@/lib/d1";
import { filterExistingProfileIds } from "@/lib/system/profileRefs";

type Actor = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  leader_id?: string | null;
};

type NotificationPayload = {
  title: string;
  content: string;
};

function labelFor(actor: Actor) {
  return actor.full_name || actor.email || actor.id.slice(0, 6);
}

export async function notifyLeadersAndAdmins(actor: Actor, payload: NotificationPayload) {
  const admins = await dbAll<{ id: string }>("select id from profiles where role = ?", [
    "super_admin"
  ]);

  const targets = await filterExistingProfileIds([
    actor.leader_id || null,
    ...(admins || []).map((row: any) => (row?.id ? String(row.id) : null))
  ]);
  if (!targets.length) return;

  const statements = targets.map((id) => ({
    sql: "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
    params: [id, actor.id, payload.title, payload.content, new Date().toISOString()]
  }));
  await dbBatch(statements);
}

export async function notifySuperAdmins(payload: NotificationPayload) {
  const admins = await dbAll<{ id: string }>("select id from profiles where role = ?", [
    "super_admin"
  ]);
  if (!admins?.length) return;
  const rows = admins
    .filter((row: any) => row?.id)
    .map((row: any) => ({
      sql: "insert into notifications (to_user_id, from_user_id, title, content, created_at) values (?, ?, ?, ?, ?)",
      params: [row.id, null, payload.title, payload.content, new Date().toISOString()]
    }));
  if (!rows.length) return;
  await dbBatch(rows);
}

export function buildStudentSubmitContent(actor: Actor, zh: string, en: string) {
  const label = labelFor(actor);
  return `学员 ${label} ${zh}\n\nStudent ${label} ${en}`;
}
