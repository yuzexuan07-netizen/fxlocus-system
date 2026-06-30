import { unstable_noStore } from "next/cache";

import { NotificationsClient } from "@/components/system/NotificationsClient";
import { dbAll } from "@/lib/d1";
import { requireSystemUser } from "@/lib/system/auth";
import { materializePinnedNotificationsForUser } from "@/lib/system/pinnedNotifications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type NotificationItem = {
  id: string;
  title: string;
  content: string;
  from_user_id: string | null;
  global_notice_id: string | null;
  read_at: string | null;
  pinned_at: string | null;
  created_at: string;
};

export default async function NotificationsPage({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  await materializePinnedNotificationsForUser(user.id).catch(() => null);
  const items = await dbAll<NotificationItem>(
    [
      "select id, title, content, from_user_id, global_notice_id, read_at, pinned_at, created_at",
      "from notifications",
      "where to_user_id = ?",
      "order by (pinned_at is not null) desc, pinned_at desc, created_at desc",
      "limit 20"
    ].join(" "),
    [user.id]
  ).catch(() => []);
  const initialMeRole = user.role === "leader" || user.role === "super_admin" ? user.role : null;

  return (
    <NotificationsClient
      locale={locale}
      initialItems={Array.isArray(items) ? items : []}
      initialUserId={user.id}
      initialMeRole={initialMeRole}
    />
  );
}

