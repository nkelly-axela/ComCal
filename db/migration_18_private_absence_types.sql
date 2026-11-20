-- =============================================================
-- migration_18_private_absence_types.sql
-- Leave Management — keep the TYPE of someone's absence private
-- =============================================================
-- Before this, every signed-in user could see what kind of leave a
-- colleague was on (sickness, maternity, compassionate...) on the team
-- calendar, and in the "overlapping leave" warning when booking. The
-- type of absence can reveal health and family information, so under
-- GDPR it is limited to the people who need it.
--
-- After this:
--   * Team calendar: everyone still sees WHO is off and WHEN, so
--     cover can be planned. The type and its colour show only to
--     admins (HR, Directors, Admin) and to the person themselves.
--     Everyone else sees "Absence" in grey.
--   * Overlap warning when booking: names and dates only, no type,
--     and it only works for your own booking.
--   * Reading leave requests directly: your own, or all of them for
--     admins and managers (managers still approve their team's
--     requests). The old "anyone can read all approved leave" rule
--     is removed.
--
-- Run in the Supabase SQL editor for the ComCal project, then deploy
-- the matching front-end change. Safe to run more than once.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. Who may see absence types (besides the person themselves)
-- -------------------------------------------------------------
create or replace function public.can_see_absence_types()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
     where id = auth.uid() and role = 'admin' and deleted_at is null
  )
$$;
revoke all on function public.can_see_absence_types() from public, anon;
grant execute on function public.can_see_absence_types() to authenticated;


-- -------------------------------------------------------------
-- 2. Team calendar view, with the type hidden from colleagues
--    (same columns as before; deleted users still hidden)
-- -------------------------------------------------------------
drop view if exists public.v_team_calendar;

create view public.v_team_calendar as
select
  lr.id,
  lr.user_id,
  case when show.ok then lr.leave_type_id end              as leave_type_id,
  lr.start_date,
  lr.end_date,
  lr.days_requested,
  lr.hours_requested,
  lr.status,
  lr.conflict_flag,
  u.full_name,
  u.department,
  u.role,
  case when show.ok then lt.name  else 'Absence' end       as leave_type_name,
  case when show.ok then lt.color else '#9CA3AF' end       as leave_type_color
from public.leave_requests lr
join public.users       u  on u.id  = lr.user_id
join public.leave_types lt on lt.id = lr.leave_type_id
cross join lateral (
  select (lr.user_id = auth.uid() or public.can_see_absence_types()) as ok
) show
where lr.status in ('approved', 'pending')
  and u.deleted_at is null
  and auth.uid() is not null;

revoke all on public.v_team_calendar from anon;
grant select on public.v_team_calendar to authenticated;


-- -------------------------------------------------------------
-- 3. Overlap warning: own bookings only, no leave type
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
)
language plpgsql security definer stable
set search_path = public
as $$
declare
  v_dept text;
begin
  -- Only for your own booking (admins and managers may check for anyone).
  if p_user_id is distinct from auth.uid() and not exists (
       select 1 from public.users where id = auth.uid() and role in ('admin', 'manager') and deleted_at is null) then
    return;
  end if;

  select department into v_dept from public.users where id = p_user_id;

  return query
  select u.id, u.full_name, lr.start_date, lr.end_date, lr.status,
         case when public.can_see_absence_types() then lt.name else 'Absence' end
  from public.leave_requests lr
  join public.users       u  on u.id  = lr.user_id
  join public.leave_types lt on lt.id = lr.leave_type_id
  where u.department = v_dept
    and u.id        <> p_user_id
    and u.deleted_at is null
    and lr.status   in ('approved', 'pending')
    and lr.start_date <= p_end
    and lr.end_date   >= p_start;
end;
$$;
revoke all on function public.get_dept_conflicts(uuid, date, date) from public, anon;
grant execute on function public.get_dept_conflicts(uuid, date, date) to authenticated;


-- -------------------------------------------------------------
-- 4. Direct reads of leave_requests: own, or admins/managers
-- -------------------------------------------------------------
drop policy if exists "Authenticated users see approved leave" on public.leave_requests;
drop policy if exists "Own leave, or admins and managers" on public.leave_requests;

create policy "Own leave, or admins and managers"
  on public.leave_requests for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.users me
                where me.id = auth.uid() and me.role in ('admin', 'manager') and me.deleted_at is null)
  );

commit;


-- =============================================================
-- CHECKS — read the results
-- =============================================================
-- Every SELECT rule left on leave_requests. If any other rule still
-- lets every signed-in user read all rows (e.g. "using (true)" or
-- "status = 'approved'"), it must be removed too.
select policyname, roles, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'leave_requests' and cmd in ('SELECT', 'ALL');

-- The calendar view now hides the type. (Run as the SQL editor this
-- returns true; it checks the view's definition, not live data.)
select pg_get_viewdef('public.v_team_calendar'::regclass) ilike '%can_see_absence_types%' as calendar_hides_types;
