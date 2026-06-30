create index if not exists profiles_role_created_at_idx
  on profiles (role, created_at desc);

create index if not exists trade_submissions_type_archived_user_created_idx
  on trade_submissions (type, archived_at, user_id, created_at desc);

create index if not exists weekly_summaries_reviewed_created_user_idx
  on weekly_summaries (reviewed_at, created_at desc, user_id);

create index if not exists records_type_created_at_idx
  on records (type, created_at desc);
