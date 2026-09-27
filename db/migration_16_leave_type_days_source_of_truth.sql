-- =============================================================
-- migration_16_leave_type_days_source_of_truth.sql
-- Leave Management — one place to set a leave type's days
-- =============================================================
-- Before this, a leave type's days were stored twice:
--   leave_types.max_days_per_year         (Leave types tab)
--   leave_type_entitlements.default_days  (Entitlements tab,
--                                          role = null)
-- and the two could disagree. Seeding reads the entitlement, so
-- changing the leave type alone had no effect on anyone.
--
-- From now on leave_types.max_days_per_year is the only value an
-- admin edits. The company-wide (role = null) entitlement row is
-- kept, because seed_annual_allowances reads it, but it is a copy
-- maintained by a trigger and can't be edited directly.
-- Role-specific entitlement rows are unchanged and still editable.
--
-- Per-person allowances (leave_allowances) are not a duplicate:
-- they are each person's own total for a holiday year and can be
-- adjusted individually. sync_leave_type_allowances() (section 4)
-- lets the admin push a changed leave type out to them.
--
-- This migration:
--   1. Reconciles existing data (the leave type wins; a leave type
--      with no days takes them from its entitlement).
--   2. Keeps the default entitlement in step with the leave type.
--   3. Blocks direct edits to the default entitlement.
--   4. Adds sync_leave_type_allowances().
--
-- Check the NOTICE output after running: every value it changed
-- is listed there.
--
-- Safe to run more than once. Run it BEFORE deploying the code
-- that uses sync_leave_type_allowances().
-- =============================================================


-- -------------------------------------------------------------
-- 1. Reconcile existing data
-- -------------------------------------------------------------
-- Runs before the triggers exist, so it can write the default
-- entitlement rows directly.
-- -------------------------------------------------------------
do $$
declare
  r record;
begin
  -- 1a. Leave types with no days take them from their default
  --     entitlement, so seeding behaves exactly as before.
  for r in
    select lt.id, lt.name, min(e.default_days) as days
    from public.leave_types lt
    join public.leave_type_entitlements e
      on e.leave_type_id = lt.id and e.role is null
    where lt.max_days_per_year is null
    group by lt.id, lt.name
  loop
    update public.leave_types set max_days_per_year = r.days where id = r.id;
    raise notice 'Leave type "%": had no days, set to % from its entitlement', r.name, r.days;
  end loop;

  -- 1b. NULL roles never conflict on a unique index, so a type can
  --     have ended up with more than one default row. Keep one.
  delete from public.leave_type_entitlements e
  using public.leave_type_entitlements keep
  where e.role is null and keep.role is null
    and e.leave_type_id = keep.leave_type_id
    and e.ctid > keep.ctid;

  -- 1c. Where the two disagree, the leave type wins.
  for r in
    select lt.id, lt.name, e.default_days as old_days, lt.max_days_per_year as new_days
    from public.leave_types lt
    join public.leave_type_entitlements e
      on e.leave_type_id = lt.id and e.role is null
    where e.default_days is distinct from lt.max_days_per_year
  loop
    update public.leave_type_entitlements
    set default_days = r.new_days
    where leave_type_id = r.id and role is null;
    raise notice 'Leave type "%": default entitlement % -> % (now matches the leave type)',
      r.name, r.old_days, r.new_days;
  end loop;

  -- 1d. Leave types with days but no default entitlement get one.
  for r in
    select lt.id, lt.name, lt.max_days_per_year as days
    from public.leave_types lt
    where lt.max_days_per_year is not null
      and not exists (
        select 1 from public.leave_type_entitlements e
        where e.leave_type_id = lt.id and e.role is null
      )
  loop
    insert into public.leave_type_entitlements (leave_type_id, role, default_days)
    values (r.id, null, r.days);
    raise notice 'Leave type "%": added default entitlement of %', r.name, r.days;
  end loop;
end;
$$;


-- -------------------------------------------------------------
-- 2. Keep the default entitlement in step with the leave type
-- -------------------------------------------------------------
create or replace function public.sync_default_entitlement()
returns trigger as $$
begin
  if new.max_days_per_year is null then
    delete from public.leave_type_entitlements
    where leave_type_id = new.id and role is null;
  else
    update public.leave_type_entitlements
    set default_days = new.max_days_per_year
    where leave_type_id = new.id and role is null;

    if not found then
      insert into public.leave_type_entitlements (leave_type_id, role, default_days)
      values (new.id, null, new.max_days_per_year);
    end if;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_default_entitlement on public.leave_types;
create trigger trg_sync_default_entitlement
  after insert or update of max_days_per_year on public.leave_types
  for each row execute function public.sync_default_entitlement();


-- -------------------------------------------------------------
-- 3. Block direct edits to the default entitlement
-- -------------------------------------------------------------
-- The trigger in section 2 always writes the leave type's own
-- value, so it passes this check; anything else is refused.
-- -------------------------------------------------------------
create or replace function public.guard_default_entitlement()
returns trigger as $$
begin
  if new.role is null and new.default_days is distinct from (
    select max_days_per_year from public.leave_types where id = new.leave_type_id
  ) then
    raise exception 'The company-wide default for a leave type is set on the Leave types tab (max days / year), not here.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_guard_default_entitlement on public.leave_type_entitlements;
create trigger trg_guard_default_entitlement
  before insert or update on public.leave_type_entitlements
  for each row execute function public.guard_default_entitlement();


-- -------------------------------------------------------------
-- 4. sync_leave_type_allowances()
-- -------------------------------------------------------------
-- Brings people's standard allowances (not rollover rows) for a
-- leave type in line with the leave type's current days, for
-- holiday year p_from_year and any later years already seeded.
--
-- Only rows still on the old default (p_old_days) are changed,
-- so anyone given a custom amount keeps it. Rows where the person
-- has already used more than the new total are left alone.
-- Deleted users are ignored.
--
-- Each change goes through adjust_allowance(), so it gets the same
-- checks and 'adjusted' audit entry as a manual Adjust.
--
-- p_apply = false is a dry run: nothing changes, and the result
-- shows what would happen. status is one of:
--   update    total is p_old_days and will be / was changed
--   overused  total is p_old_days but used_days > new days; left
--   custom    total differs from p_old_days; left
-- Rows already on the new value aren't returned.
-- -------------------------------------------------------------
drop function if exists public.sync_leave_type_allowances(uuid, integer, numeric, uuid, boolean);

create or replace function public.sync_leave_type_allowances(
  p_leave_type_id uuid,
  p_from_year     integer,
  p_old_days      numeric,
  p_performed_by  uuid,
  p_apply         boolean default false
)
returns table (
  user_id    uuid,
  full_name  text,
  year       integer,
  total_days numeric,
  used_days  numeric,
  status     text
) as $$
declare
  v_new_days numeric;
  v_type     text;
  r          record;
begin
  select lt.max_days_per_year, lt.name into v_new_days, v_type
  from public.leave_types lt
  where lt.id = p_leave_type_id;

  if v_new_days is null then
    raise exception 'This leave type has no max days / year set.';
  end if;

  for r in
    select la.user_id, u.full_name, la.year, la.total_days, la.used_days
    from public.leave_allowances la
    join public.users u on u.id = la.user_id
    where la.leave_type_id = p_leave_type_id
      and la.year >= p_from_year
      and la.notes is null            -- standard row, not rollover
      and u.deleted_at is null
      and la.total_days is distinct from v_new_days
    order by la.year, u.full_name
  loop
    user_id    := r.user_id;
    full_name  := r.full_name;
    year       := r.year;
    total_days := r.total_days;
    used_days  := r.used_days;

    if r.total_days is distinct from p_old_days then
      status := 'custom';
    elsif r.used_days > v_new_days then
      status := 'overused';
    else
      status := 'update';
      if p_apply then
        perform public.adjust_allowance(
          p_user_id       := r.user_id,
          p_leave_type_id := p_leave_type_id,
          p_year          := r.year,
          p_new_total     := v_new_days,
          p_performed_by  := p_performed_by,
          p_note          := v_type || ' changed from ' || p_old_days || ' to ' || v_new_days || ' days'
        );
      end if;
    end if;

    return next;
  end loop;
end;
$$ language plpgsql;
