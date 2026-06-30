alter table consult_messages
  add column reply_to_message_id text references consult_messages(id) on delete set null;

create index if not exists consult_messages_reply_to_idx
  on consult_messages (reply_to_message_id);
