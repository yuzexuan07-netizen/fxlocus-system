-- PR-2 防崩：建立 D1 迁移版本记录表
create table if not exists schema_migrations (
  version text primary key,
  name text not null,
  checksum text not null,
  applied_at text not null default (CURRENT_TIMESTAMP)
);

