alter table courses add column course_type text not null default 'advanced';
alter table courses add column sort_order integer;

update courses
set course_type = 'advanced'
where course_type is null or trim(course_type) = '';

update courses
set sort_order = id
where sort_order is null;

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

create unique index if not exists course_group_access_user_type_uidx
  on course_group_access (user_id, course_type);

create index if not exists course_group_access_type_status_idx
  on course_group_access (course_type, status);

create index if not exists courses_type_sort_idx
  on courses (course_type, sort_order, id);
