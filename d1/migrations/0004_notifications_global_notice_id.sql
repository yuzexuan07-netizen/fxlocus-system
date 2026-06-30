alter table notifications add column global_notice_id text;

create index if not exists notifications_global_notice_idx
  on notifications (global_notice_id, from_user_id);
