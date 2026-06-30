-- Ensure one access record per (user_id, course_id) pair before adding unique index.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, course_id
      order by
        coalesce(updated_at, reviewed_at, requested_at, completed_at, "") desc,
        case status
          when 'completed' then 4
          when 'approved' then 3
          when 'requested' then 2
          when 'rejected' then 1
          else 0
        end desc,
        id desc
    ) as rn
  from course_access
)
delete from course_access
where id in (select id from ranked where rn > 1);

create unique index if not exists course_access_user_course_uidx
  on course_access (user_id, course_id);
