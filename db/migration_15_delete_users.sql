-- =============================================================
-- migration_15_delete_users.sql
-- Leave Management — soft-delete users
-- =============================================================
-- "Deleting" a user in Admin → Employees marks them as deleted
-- rather than removing the row, so their leave requests,
-- allowances and audit history stay intact.
--
-- The rest of the delete (blocking sign-in, password resets and
-- emails) happens in api/delete-user.js with the service role key.
--
-- This migration:
--   1. Adds users.deleted_at / users.deleted_by.
--   2. Hides deleted users from the team calendar
--      (v_team_calendar), keeping the view's existing columns.
--
-- Safe to run more than once. Run it BEFORE deploying the code
-- that uses these columns.
-- =============================================================


-- -------------------------------------------------------------
-- 1. Soft-delete columns
-- -------------------------------------------------------------
alter table public.users add column if not exists deleted_at timestamptz;
alter table public.users add column if not exists deleted_by uuid;

create index if not exists users_deleted_at_idx
  on public.users (deleted_at)
  where deleted_at is not null;


-- -------------------------------------------------------------
-- 2. Hide deleted users from the team calendar
-- -------------------------------------------------------------
-- The live view may have been edited since migration_05, so
-- rather than re-typing it we wrap whatever is there now in an
-- outer filter. Columns (and grants) are unchanged.
-- -------------------------------------------------------------
do $$
declare
  v_def text;
begin
  if to_regclass('public.v_team_calendar') is null then
    raise notice 'Step 2: SKIPPED (public.v_team_calendar does not exist)';
    return;
  end if;

  v_def := pg_get_viewdef('public.v_team_calendar'::regclass, true);

  if v_def ilike '%deleted_at%' then
    raise notice 'Step 2: v_team_calendar already filters deleted users';
    return;
  end if;

  v_def := rtrim(v_def, E'; \n\t');

  execute format($v$
    create or replace view public.v_team_calendar as
    select cal.*
      from (%s) cal
     where not exists (
       select 1 from public.users du
        where du.id = cal.user_id
          and du.deleted_at is not null
     )
  $v$, v_def);

  raise notice 'Step 2: v_team_calendar now hides deleted users';
end $$;
