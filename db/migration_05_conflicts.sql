-- =============================================================
-- migration_05_conflicts.sql
-- Conflict detection layer for leave_requests + v_team_calendar
-- Run AFTER migration_01 through migration_04
-- =============================================================

-- -------------------------------------------------------------
-- 1. Add conflict_flag + conflict_detail to leave_requests
--    Populated at insert time by the user panel when it detects
--    overlapping department requests. Surfaced in admin panel.
-- -------------------------------------------------------------
alter table public.leave_requests
  add column if not exists conflict_flag    boolean default false,
  add column if not exists conflict_detail  text;

-- -------------------------------------------------------------
-- 2. v_team_calendar — safe read-only view for the calendar
--    Exposes approved AND pending leave (pending shown differently)
--    No reason, no admin_note — safe for all authenticated users
-- -------------------------------------------------------------
drop view if exists public.v_team_calendar;

create view public.v_team_calendar as
select
  lr.id,
  lr.user_id,
  lr.leave_type_id,
  lr.start_date,
  lr.end_date,
  lr.days_requested,
  lr.hours_requested,
  lr.status,
  lr.conflict_flag,
  u.full_name,
  u.department,
  u.role,
  lt.name  as leave_type_name,
  lt.color as leave_type_color
from public.leave_requests lr
join public.users       u  on u.id  = lr.user_id
join public.leave_types lt on lt.id = lr.leave_type_id
where lr.status in ('approved', 'pending');

-- Grant read to authenticated users (RLS on underlying tables still applies)
grant select on public.v_team_calendar to authenticated;

-- -------------------------------------------------------------
-- 3. Function: get_dept_conflicts(user_id, start_date, end_date)
--    Returns overlapping approved/pending leave rows for the
--    same department. Called client-side before insert.
-- -------------------------------------------------------------
create or replace function public.get_dept_conflicts(
  p_user_id  uuid,
  p_start    date,
  p_end      date
)
returns table (
  conflict_user_id   uuid,
  conflict_user_name text,
  conflict_start     date,
  conflict_end       date,
  conflict_status    text,
  conflict_type      text
) as $$
declare
  v_dept text;
begin
  select department into v_dept
  from public.users where id = p_user_id;

  return query
  select
    u.id,
    u.full_name,
    lr.start_date,
    lr.end_date,
    lr.status,
    lt.name
  from public.leave_requests lr
  join public.users       u  on u.id  = lr.user_id
  join public.leave_types lt on lt.id = lr.leave_type_id
  where u.department = v_dept
    and u.id        <> p_user_id
    and lr.status   in ('approved', 'pending')
    and lr.start_date <= p_end
    and lr.end_date   >= p_start;
end;
$$ language plpgsql security definer stable;

-- Grant execute to authenticated
grant execute on function public.get_dept_conflicts(uuid, date, date) to authenticated;

-- -------------------------------------------------------------
-- 4. Index to accelerate conflict lookups
-- -------------------------------------------------------------
create index if not exists leave_requests_dept_dates_idx
  on public.leave_requests (status, start_date, end_date)
  where status in ('approved', 'pending');

-- -------------------------------------------------------------
-- VERIFICATION
-- -------------------------------------------------------------
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'leave_requests'
  and column_name  in ('conflict_flag', 'conflict_detail');

select viewname from pg_views
where schemaname = 'public' and viewname = 'v_team_calendar';
