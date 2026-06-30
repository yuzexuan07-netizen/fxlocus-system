alter table notifications add column pinned_at text;

create index if not exists notifications_to_user_pinned_idx
  on notifications (to_user_id, pinned_at desc, created_at desc);
