-- D1 schema (source of truth)
-- SQLite/D1 compatible, no RLS, functions, or enums
PRAGMA foreign_keys = ON;

create table if not exists profiles (
  id text primary key,
  email text unique,
  full_name text,
  phone text,
  role text not null default 'student',
  leader_id text references profiles(id) on delete set null,
  student_status text not null default '普通学员',
  is_coach integer not null default false,
  source text,
  status text not null default 'active',
  avatar_url text,
  last_login_at text,
  last_login_ip text,
  last_login_user_agent text,
  session_id text,
  created_by text references profiles(id) on delete set null,
  created_at text not null default (CURRENT_TIMESTAMP),
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists local_auth_users (
  user_id text primary key references profiles(id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  password_updated_at text not null default (CURRENT_TIMESTAMP),
  created_at text not null default (CURRENT_TIMESTAMP),
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create index if not exists local_auth_users_email_idx on local_auth_users (email);
create table if not exists role_audit_logs (
  id text primary key default (lower(hex(randomblob(16)))),
  target_id text not null references profiles(id) on delete cascade,
  actor_id text not null references profiles(id) on delete cascade,
  from_role text not null,
  to_role text not null,
  reason text,
  created_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists notifications (
  id text primary key default (lower(hex(randomblob(16)))),
  to_user_id text not null references profiles(id) on delete cascade,
  from_user_id text references profiles(id) on delete set null,
  global_notice_id text,
  title text not null,
  content text,
  read_at text,
  pinned_at text,
  created_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists consult_messages (
  id text primary key default (lower(hex(randomblob(16)))),
  from_user_id text not null references profiles(id) on delete cascade,
  to_user_id text not null references profiles(id) on delete cascade,
  content_type text not null default 'text',
  content_text text,
  image_bucket text,
  image_path text,
  image_name text,
  image_mime_type text,
  image_size_bytes integer,
  audio_duration_sec real,
  reply_to_message_id text references consult_messages(id) on delete set null,
  read_at text,
  created_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists courses (
  id int primary key,
  course_type text not null default 'advanced',
  sort_order integer,
  title_zh text,
  title_en text,
  summary_zh text,
  summary_en text,
  content_bucket text,
  content_path text,
  content_mime_type text,
  content_file_name text,
  video_variants text,
  published integer not null default false,
  deleted_at text,
  created_at text not null default (CURRENT_TIMESTAMP),
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists course_group_access (
  id text primary key default (lower(hex(randomblob(16)))),
  user_id text not null references profiles(id) on delete cascade,
  course_type text not null,
  status text not null default 'approved'
    check (status in ('approved', 'rejected')),
  reviewed_at text,
  reviewed_by text references profiles(id),
  rejection_reason text,
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists course_access (
  id text primary key default (lower(hex(randomblob(16)))),
  user_id text not null references profiles(id) on delete cascade,
  course_id int not null references courses(id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'completed')),
  rejection_reason text,
  progress int not null default 0,
  last_video_sec int not null default 0,
  completed_at text,
  requested_at text not null default (CURRENT_TIMESTAMP),
  reviewed_at text,
  reviewed_by text references profiles(id),
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists course_notes (
  id text primary key default (lower(hex(randomblob(16)))),
  user_id text not null references profiles(id) on delete cascade,
  course_id int not null references courses(id) on delete cascade,
  content_md text,
  content_html text,
  submitted_at text,
  reviewed_at text,
  reviewed_by text references profiles(id),
  review_note text,
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists files (
  id text primary key default (lower(hex(randomblob(16)))),
  category text,
  name text not null,
  description text,
  storage_bucket text not null,
  storage_path text not null,
  size_bytes integer not null default 0,
  mime_type text,
  uploaded_by text references profiles(id),
  created_at text not null default (CURRENT_TIMESTAMP),
  updated_at text not null default (CURRENT_TIMESTAMP),
  file_type text,
  course_id int references courses(id) on delete set null,
  lesson_id int,
  thumbnail_bucket text,
  thumbnail_path text
);

create table if not exists file_permissions (
  file_id text not null references files(id) on delete cascade,
  grantee_profile_id text not null references profiles(id) on delete cascade,
  granted_by text references profiles(id),
  created_at text not null default (CURRENT_TIMESTAMP),
  primary key (file_id, grantee_profile_id)
);

create table if not exists file_access_requests (
  user_id text not null references profiles(id) on delete cascade,
  file_id text not null references files(id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected')),
  requested_at text not null default (CURRENT_TIMESTAMP),
  reviewed_at text,
  reviewed_by text references profiles(id),
  rejection_reason text,
  primary key (user_id, file_id)
);

create table if not exists file_download_logs (
  id text primary key default (lower(hex(randomblob(16)))),
  file_id text not null references files(id) on delete cascade,
  user_id text not null references profiles(id) on delete cascade,
  ip text,
  user_agent text,
  downloaded_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists trade_submissions (
  id text primary key default (lower(hex(randomblob(16)))),
  user_id text not null references profiles(id) on delete cascade,
  leader_id text references profiles(id) on delete set null,
  type text not null check (type in ('trade_log', 'trade_strategy')),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_at text,
  reviewed_by text references profiles(id),
  review_note text,
  archived_at text,
  archived_by text references profiles(id),
  created_at text not null default (CURRENT_TIMESTAMP),
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists trade_submission_files (
  id text primary key default (lower(hex(randomblob(16)))),
  submission_id text not null references trade_submissions(id) on delete cascade,
  file_name text not null,
  storage_bucket text not null,
  storage_path text not null,
  size_bytes integer not null default 0,
  mime_type text,
  created_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists classic_trades (
  id text primary key default (lower(hex(randomblob(16)))),
  user_id text not null references profiles(id) on delete cascade,
  leader_id text references profiles(id) on delete set null,
  reason text not null,
  image_bucket text not null,
  image_path text not null,
  image_name text,
  image_mime_type text,
  reviewed_at text,
  reviewed_by text references profiles(id),
  review_note text,
  created_at text not null default (CURRENT_TIMESTAMP),
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists weekly_summaries (
  id text primary key default (lower(hex(randomblob(16)))),
  user_id text not null references profiles(id) on delete cascade,
  leader_id text references profiles(id) on delete set null,
  student_name text not null,
  summary_text text not null,
  strategy_text text,
  strategy_bucket text not null,
  strategy_path text not null,
  strategy_name text,
  strategy_mime_type text,
  curve_text text,
  curve_bucket text not null,
  curve_path text not null,
  curve_name text,
  curve_mime_type text,
  stats_text text,
  stats_bucket text not null,
  stats_path text not null,
  stats_name text,
  stats_mime_type text,
  reviewed_at text,
  reviewed_by text references profiles(id),
  review_note text,
  created_at text not null default (CURRENT_TIMESTAMP),
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists records (
  id text primary key default (lower(hex(randomblob(16)))),
  type text,
  email text,
  name text,
  payload text,
  content text,
  read_at text,
  created_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists admin_record_read_marks (
  record_type text not null,
  record_id text not null,
  read_at text not null,
  updated_at text not null default (CURRENT_TIMESTAMP),
  primary key (record_type, record_id)
);

create table if not exists donation_metrics (
  key text primary key,
  base_amount real not null default 999,
  current_amount real not null default 1555,
  daily_increase real not null default 5,
  last_increment_date date not null default current_date,
  created_at text not null default (CURRENT_TIMESTAMP),
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists contact_submissions (
  id text primary key default (lower(hex(randomblob(16)))),
  name text,
  email text not null,
  wechat text,
  intent text,
  bottleneck text,
  instruments text,
  message text,
  locale text,
  ip text,
  user_agent text,
  payload text,
  created_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists donation_applications (
  id text primary key default (lower(hex(randomblob(16)))),
  email text not null,
  name text,
  wechat text,
  locale text,
  ip text,
  user_agent text,
  payload text,
  created_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists student_documents (
  id text primary key default (lower(hex(randomblob(16)))),
  student_id text not null references profiles(id) on delete cascade,
  uploaded_by text references profiles(id) on delete set null,
  doc_type text not null,
  storage_bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes integer not null default 0,
  reviewed_at text,
  reviewed_by text references profiles(id),
  created_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists ladder_authorizations (
  user_id text primary key references profiles(id) on delete cascade,
  enabled integer not null default false,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_at text,
  reviewed_at text,
  reviewed_by text references profiles(id),
  rejection_reason text,
  created_at text not null default (CURRENT_TIMESTAMP),
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists ladder_snapshots (
  id text primary key default (lower(hex(randomblob(16)))),
  storage_bucket text not null,
  storage_path text not null,
  created_by text references profiles(id) on delete set null,
  captured_at text not null default (CURRENT_TIMESTAMP),
  created_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists ladder_config (
  id int primary key,
  image_url text not null,
  refresh_ms int not null default 60000,
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create table if not exists coach_assignments (
  id text primary key default (lower(hex(randomblob(16)))),
  coach_id text not null references profiles(id) on delete cascade,
  assigned_user_id text not null references profiles(id) on delete cascade,
  assigned_by text not null references profiles(id) on delete restrict,
  created_at text not null default (CURRENT_TIMESTAMP),
  updated_at text not null default (CURRENT_TIMESTAMP),
  unique (assigned_user_id)
);

create table if not exists job_runs (
  job_name text primary key,
  running integer not null default false,
  locked_until text,
  last_started_at text,
  last_finished_at text,
  last_error text
);

create table if not exists login_rate_limits (
  key text primary key,
  count integer not null default 0,
  reset_at_ms integer not null,
  updated_at text not null default (CURRENT_TIMESTAMP)
);

create index if not exists profiles_role_idx on profiles (role);

create index if not exists profiles_role_created_at_idx on profiles (role, created_at desc);

create index if not exists profiles_leader_idx on profiles (leader_id);

create index if not exists profiles_email_idx on profiles (email);

create index if not exists profiles_status_idx on profiles (status);

create index if not exists profiles_source_idx on profiles (source);

create index if not exists profiles_created_by_idx on profiles (created_by);

create index if not exists profiles_session_id_idx on profiles (session_id);

create index if not exists login_rate_limits_reset_at_idx on login_rate_limits (reset_at_ms);

create index if not exists notifications_to_user_idx on notifications (to_user_id, read_at, created_at desc);
create index if not exists notifications_to_user_pinned_idx on notifications (to_user_id, pinned_at desc, created_at desc);
create index if not exists notifications_global_notice_idx on notifications (global_notice_id, from_user_id);

create index if not exists consult_messages_pair_idx
  on consult_messages (from_user_id, to_user_id, created_at desc);

create index if not exists consult_messages_to_idx
  on consult_messages (to_user_id, read_at, created_at desc);

create index if not exists consult_messages_to_from_read_idx
  on consult_messages (to_user_id, read_at, from_user_id);

create index if not exists consult_messages_to_created_from_idx
  on consult_messages (to_user_id, created_at desc, from_user_id);

create index if not exists consult_messages_reply_to_idx
  on consult_messages (reply_to_message_id);

create index if not exists course_access_status_idx on course_access (status);

create unique index if not exists course_group_access_user_type_uidx
  on course_group_access (user_id, course_type);

create index if not exists course_group_access_type_status_idx
  on course_group_access (course_type, status);

create index if not exists courses_type_sort_idx
  on courses (course_type, sort_order, id);

create index if not exists course_access_status_user_idx on course_access (status, user_id);

create unique index if not exists course_access_user_course_uidx
  on course_access (user_id, course_id);

create index if not exists course_access_user_idx on course_access (user_id);

create index if not exists course_notes_pending_user_idx
  on course_notes (reviewed_at, submitted_at, user_id);

create index if not exists files_created_at_idx on files (created_at desc);

create index if not exists files_course_id_idx on files (course_id);

create index if not exists files_file_type_idx on files (file_type);

create index if not exists file_permissions_grantee_idx on file_permissions (grantee_profile_id);

create index if not exists file_access_requests_status_idx on file_access_requests (status, requested_at desc);

create index if not exists file_access_requests_status_user_idx on file_access_requests (status, user_id);

create index if not exists file_download_logs_file_idx on file_download_logs (file_id, downloaded_at desc);

create index if not exists trade_submissions_user_idx on trade_submissions (user_id, created_at desc);

create index if not exists trade_submissions_leader_idx on trade_submissions (leader_id, created_at desc);

create index if not exists trade_submissions_type_idx on trade_submissions (type, status);

create index if not exists trade_submissions_archived_idx on trade_submissions (archived_at desc);

create index if not exists trade_submissions_pending_scope_idx
  on trade_submissions (status, archived_at, type, user_id);

create index if not exists trade_submissions_type_archived_user_created_idx
  on trade_submissions (type, archived_at, user_id, created_at desc);

create index if not exists trade_submission_files_submission_idx on trade_submission_files (submission_id);

create index if not exists classic_trades_user_idx on classic_trades (user_id, created_at desc);

create index if not exists classic_trades_leader_idx on classic_trades (leader_id, created_at desc);

create index if not exists classic_trades_reviewed_user_idx
  on classic_trades (reviewed_at, user_id);

create index if not exists weekly_summaries_user_idx on weekly_summaries (user_id, created_at desc);

create index if not exists weekly_summaries_leader_idx on weekly_summaries (leader_id, created_at desc);

create index if not exists weekly_summaries_reviewed_user_idx
  on weekly_summaries (reviewed_at, user_id);

create index if not exists weekly_summaries_reviewed_created_user_idx
  on weekly_summaries (reviewed_at, created_at desc, user_id);

create index if not exists records_type_idx on records (type);

create index if not exists records_type_created_at_idx on records (type, created_at desc);

create index if not exists records_created_at_idx on records (created_at desc);

create index if not exists admin_record_read_marks_type_idx on admin_record_read_marks (record_type, updated_at desc);

create index if not exists records_email_idx on records (email);

create index if not exists contact_submissions_created_at_idx on contact_submissions (created_at desc);

create index if not exists contact_submissions_email_idx on contact_submissions (email);

create index if not exists donation_applications_created_at_idx on donation_applications (created_at desc);

create index if not exists donation_applications_email_idx on donation_applications (email);

create index if not exists student_documents_student_idx on student_documents (student_id);

create index if not exists student_documents_type_idx on student_documents (doc_type);

create index if not exists student_documents_created_at_idx on student_documents (created_at desc);

create index if not exists student_documents_reviewed_idx
  on student_documents (reviewed_at desc);

create index if not exists student_documents_reviewed_student_idx
  on student_documents (reviewed_at, student_id);

create index if not exists ladder_authorizations_status_idx on ladder_authorizations (status, requested_at desc);

create index if not exists ladder_authorizations_status_user_idx
  on ladder_authorizations (status, user_id);

create index if not exists ladder_authorizations_reviewed_idx on ladder_authorizations (reviewed_at desc);

create index if not exists ladder_snapshots_captured_idx on ladder_snapshots (captured_at desc);

create index if not exists coach_assignments_coach_idx
  on coach_assignments (coach_id, created_at desc);

create index if not exists coach_assignments_user_idx
  on coach_assignments (assigned_user_id);

