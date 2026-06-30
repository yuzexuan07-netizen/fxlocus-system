create index if not exists consult_messages_to_from_read_idx
  on consult_messages (to_user_id, read_at, from_user_id);

create index if not exists trade_submissions_pending_scope_idx
  on trade_submissions (status, archived_at, type, user_id);

create index if not exists classic_trades_reviewed_user_idx
  on classic_trades (reviewed_at, user_id);

create index if not exists weekly_summaries_reviewed_user_idx
  on weekly_summaries (reviewed_at, user_id);

create index if not exists course_notes_pending_user_idx
  on course_notes (reviewed_at, submitted_at, user_id);

create index if not exists student_documents_reviewed_student_idx
  on student_documents (reviewed_at, student_id);

create index if not exists ladder_authorizations_status_user_idx
  on ladder_authorizations (status, user_id);
