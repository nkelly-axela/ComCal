-- =============================================================
-- migration_04_calendar.sql
-- Leave Management — Team Calendar additions (defensive)
-- Run AFTER migration_01, migration_02, and migration_03
-- =============================================================
-- Adds, idempotently and only if prerequisite tables exist:
--   1. users.department  (text, nullable) — used by LeaveCalendar
--      to group rows under department headers.
--   2. RLS policy that lets every authenticated user read
--      APPROVED leave_requests rows so the team calendar isn't
--      empty for non-admins. Pending / rejected rows from other
--      users remain hidden; users always see their own.
--   3. Composite index on (status, start_date, end_date) — keeps
--      the month-window query the calendar runs fast at scale.
--
-- Each step checks the prerequisite table exists. If it doesn't,
-- the step is skipped with a clear NOTICE so you can see what's
-- missing instead of getting a hard error.
-- =============================================================


-- -------------------------------------------------------------
-- 0. Pre-flight check
-- -------------------------------------------------------------
do $$
declare
  v_users_exists  boolean;
  v_lr_exists     boolean;
begin
  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'users'
  ) into v_users_exists;

  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'leave_requests'
  ) into v_lr_exists;

  raise notice '------------------------------------------------------------';
  raise notice 'Pre-flight: public.users          %', case when v_users_exists then 'OK' else 'MISSING (run migration_01 first)' end;
  raise notice 'Pre-flight: public.leave_requests %', case when v_lr_exists    then 'OK' else 'MISSING (run migration_01 first)' end;
  raise notice '------------------------------------------------------------';
end $$;


-- -------------------------------------------------------------
-- 1. Department column on users
-- -------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'users'
  ) then
    alter table public.users add column if not exists department text;
    raise notice 'Step 1: added/confirmed department column on public.users';
  else
    raise notice 'Step 1: SKIPPED (public.users does not exist)';
  end if;
end $$;

-- Optional backfill examples — uncomment and adjust to your team:
-- update public.users set department = 'Engineering' where role = 'employee';
-- update public.users set department = 'People'      where role = 'manager';
-- update public.users set department = 'Design'      where full_name = 'Priya Nair';


-- -------------------------------------------------------------
-- 2. Calendar visibility policy on leave_requests
-- -------------------------------------------------------------
-- Anyone signed in can see:
--   - approved leave from anyone (so the team calendar populates), and
--   - their own requests at any status (so the user panel still works).
-- Pending or rejected leave from OTHER users stays hidden.
-- -------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'leave_requests'
  ) then
    drop policy if exists "Authenticated users see approved leave"
      on public.leave_requests;

    create policy "Authenticated users see approved leave"
      on public.leave_requests for select
      to authenticated
      using (status = 'approved' or user_id = auth.uid());

    raise notice 'Step 2: created policy on public.leave_requests';
  else
    raise notice 'Step 2: SKIPPED (public.leave_requests does not exist)';
  end if;
end $$;


-- -------------------------------------------------------------
-- 3. Performance index for the month-window query
-- -------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'leave_requests'
  ) then
    create index if not exists leave_requests_status_dates_idx
      on public.leave_requests (status, start_date, end_date);
    raise notice 'Step 3: created/confirmed index on public.leave_requests';
  else
    raise notice 'Step 3: SKIPPED (public.leave_requests does not exist)';
  end if;
end $$;


-- =============================================================
-- VERIFICATION
-- These will return zero rows if the underlying tables don't exist
-- =============================================================

-- 1. Confirm department column
select 'department column' as check_name,
       column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'users'
   and column_name  = 'department';

-- 2. Confirm policy
select 'rls policy' as check_name,
       policyname, cmd, qual
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'leave_requests'
   and policyname = 'Authenticated users see approved leave';

-- 3. Confirm index
select 'index' as check_name,
       indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and tablename  = 'leave_requests'
   and indexname  = 'leave_requests_status_dates_idx';
