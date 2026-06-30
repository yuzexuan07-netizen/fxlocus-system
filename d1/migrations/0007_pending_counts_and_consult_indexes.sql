create index if not exists consult_messages_to_created_from_idx
  on consult_messages (to_user_id, created_at desc, from_user_id);

create index if not exists course_access_status_user_idx
  on course_access (status, user_id);

create index if not exists file_access_requests_status_user_idx
  on file_access_requests (status, user_id);
