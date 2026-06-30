create table if not exists system_response_cache (
  cache_key text primary key,
  value_json text not null,
  fresh_until_ms integer not null default 0,
  stale_until_ms integer not null default 0,
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create index if not exists idx_system_response_cache_stale_until
  on system_response_cache(stale_until_ms);
