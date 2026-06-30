create index if not exists profiles_session_id_idx on profiles (session_id);

create table if not exists login_rate_limits (
  key text primary key,
  count integer not null default 0,
  reset_at_ms integer not null,
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create index if not exists login_rate_limits_reset_at_idx on login_rate_limits (reset_at_ms);
