-- =============================================================
-- migration_17_allowance_extras.sql
-- Leave Management — extra days stored separately from the base
-- =============================================================
-- Before this, granting someone extra days meant overwriting
-- their total (20 -> 22). The reason was lost, the extra didn't
-- follow a change to the company default, and seeding the next
-- year reset them to the default.
--
-- Now a person's standard allowance for a year is:
--
--   total_days = base_days + extras
--
--   base_days  what they'd get without extras: the leave type's
--              days (or a role rule) when seeded, or a custom base
--              for e.g. part-time / pro-rata starters.
--   extras     rows in leave_allowance_extras: days (+ or -), a
--              reason, and the holiday years they apply to (one
--              year, or every year from a start year).
--
-- total_days is kept on leave_allowances because the balance view,
-- deduction and overuse checks all read it, but it's worked out by
-- a trigger and never set directly. For compatibility, a direct
-- write to total_days (e.g. adjust_allowance, or an insert from
-- seed_annual_allowances) is read as "set the base so the total
-- comes to this", so existing code paths keep working. Recurring
-- extras are applied automatically when a new year is seeded.
--
-- Rollover rows (notes like 'Rollover from%') are not affected.
--
-- This migration:
--   1. Creates leave_allowance_extras (+ RLS).
--   2. Adds leave_allowances.base_days, set to today's total.
--   3. Adds the trigger that keeps total_days = base + extras.
--   4. Adds add_allowance_extra(), remove_allowance_extra() and
--      set_allowance_base(), each writing the audit log.
--   5. Replaces sync_leave_type_allowances() (migration_16) so a
--      leave type change moves people's base, and their extras
--      stay on top.
--   6. Lists (NOTICE) this year's allowances whose base differs
--      from the default, i.e. earlier one-off grants you may want
--      to re-record as extras. Nothing is changed for them.
--
-- Run migration_16 first. Safe to run more than once. Run it
-- BEFORE deploying the code that uses these functions.
-- =============================================================


-- -------------------------------------------------------------
-- 1. leave_allowance_extras
-- -------------------------------------------------------------
create table if not exists public.leave_allowance_extras (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id),
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  days          numeric not null check (days <> 0),
  reason        text not null check (length(trim(reason)) > 0),
  from_year     integer not null,
  to_year       integer,          -- null = every year from from_year
  created_by    uuid,
  created_at    timestamptz not null default now(),
  check (to_year is null or to_year >= from_year)
);

create index if not exists leave_allowance_extras_user_type_idx
  on public.leave_allowance_extras (user_id, leave_type_id);

alter table public.leave_allowance_extras enable row level security;

drop policy if exists "Users read own allowance extras" on public.leave_allowance_extras;
create policy "Users read own allowance extras"
  on public.leave_allowance_extras for select
  using (user_id = auth.uid());

drop policy if exists "Admins manage allowance extras" on public.leave_allowance_extras;
create policy "Admins manage allowance extras"
  on public.leave_allowance_extras for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin', 'manager')
    )
  );

-- Total extra days for one person / leave type / holiday year.
create or replace function public.allowance_extras_total(
  p_user_id uuid, p_leave_type_id uuid, p_year integer
)
returns numeric as $$
  select coalesce(sum(e.days), 0)
  from public.leave_allowance_extras e
  where e.user_id = p_user_id
    and e.leave_type_id = p_leave_type_id
    and e.from_year <= p_year
    and (e.to_year is null or e.to_year >= p_year)
$$ language sql stable;


-- -------------------------------------------------------------
-- 2. base_days
-- -------------------------------------------------------------
-- There are no extras yet, so each standard row's base is its
-- current total. Done before the trigger in section 3 exists.
-- -------------------------------------------------------------
alter table public.leave_allowances add column if not exists base_days numeric;

update public.leave_allowances
set base_days = total_days
where base_days is null
  and coalesce(notes, '') not like 'Rollover from%';


-- -------------------------------------------------------------
-- 3. Keep total_days = base_days + extras
-- -------------------------------------------------------------
create or replace function public.leave_allowance_total()
returns trigger as $$
declare
  v_extras numeric;
begin
  if coalesce(new.notes, '') like 'Rollover from%' then
    return new;
  end if;

  v_extras := public.allowance_extras_total(new.user_id, new.leave_type_id, new.year);

  if tg_op = 'INSERT' then
    -- Seeding / "Add allowance" supply total_days: that's the base.
    new.base_days := coalesce(new.base_days, new.total_days);
  elsif new.base_days is null
     or (new.total_days is distinct from old.total_days
         and new.base_days is not distinct from old.base_days) then
    -- Someone set the total directly: move the base to match.
    new.base_days := new.total_days - v_extras;
  end if;

  new.total_days := new.base_days + v_extras;

  if tg_op = 'UPDATE' then
    if new.total_days < old.total_days and new.total_days < new.used_days then
      raise exception 'That would leave % days, but % have already been used.',
        new.total_days, new.used_days;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_leave_allowance_total on public.leave_allowances;
create trigger trg_leave_allowance_total
  before insert or update on public.leave_allowances
  for each row execute function public.leave_allowance_total();

-- When extras change, recalculate that person's allowances for the
-- type. Touching the row re-runs the trigger above.
create or replace function public.recalc_allowances(p_user_id uuid, p_leave_type_id uuid)
returns void as $$
  update public.leave_allowances la
  set base_days = la.base_days
  where la.user_id = p_user_id
    and la.leave_type_id = p_leave_type_id
    and coalesce(la.notes, '') not like 'Rollover from%'
$$ language sql;

create or replace function public.recalc_allowances_for_extra()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    perform public.recalc_allowances(new.user_id, new.leave_type_id);
  elsif tg_op = 'DELETE' then
    perform public.recalc_allowances(old.user_id, old.leave_type_id);
  else
    perform public.recalc_allowances(old.user_id, old.leave_type_id);
    if (new.user_id, new.leave_type_id) is distinct from (old.user_id, old.leave_type_id) then
      perform public.recalc_allowances(new.user_id, new.leave_type_id);
    end if;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_recalc_allowances_for_extra on public.leave_allowance_extras;
create trigger trg_recalc_allowances_for_extra
  after insert or update or delete on public.leave_allowance_extras
  for each row execute function public.recalc_allowances_for_extra();


-- -------------------------------------------------------------
-- 4. Admin actions (each writes the audit log)
-- -------------------------------------------------------------
-- Audit entries use the existing 'adjusted' action, with the
-- detail in the note.
-- -------------------------------------------------------------

-- The standard total for a person / type / year, for audit entries.
create or replace function public.standard_allowance_total(
  p_user_id uuid, p_leave_type_id uuid, p_year integer
)
returns numeric as $$
  select la.total_days
  from public.leave_allowances la
  where la.user_id = p_user_id
    and la.leave_type_id = p_leave_type_id
    and la.year = p_year
    and coalesce(la.notes, '') not like 'Rollover from%'
  limit 1
$$ language sql stable;

create or replace function public.add_allowance_extra(
  p_user_id       uuid,
  p_leave_type_id uuid,
  p_days          numeric,
  p_reason        text,
  p_from_year     integer,
  p_recurring     boolean,
  p_performed_by  uuid
)
returns uuid as $$
declare
  v_id uuid;
begin
  insert into public.leave_allowance_extras
    (user_id, leave_type_id, days, reason, from_year, to_year, created_by)
  values
    (p_user_id, p_leave_type_id, p_days, trim(p_reason), p_from_year,
     case when p_recurring then null else p_from_year end, p_performed_by)
  returning id into v_id;

  insert into public.leave_audit_log
    (user_id, leave_type_id, year, action, days_affected, new_total_days, performed_by, note)
  values
    (p_user_id, p_leave_type_id, p_from_year, 'adjusted', p_days,
     public.standard_allowance_total(p_user_id, p_leave_type_id, p_from_year), p_performed_by,
     case when p_days > 0 then '+' else '' end || p_days || ' extra days ('
       || case when p_recurring then 'every year from ' || p_from_year else p_from_year || ' only' end
       || '): ' || trim(p_reason));

  return v_id;
end;
$$ language plpgsql;

-- Removes an extra from p_from_year onwards. Earlier years it
-- applied to keep it, so past totals don't change.
create or replace function public.remove_allowance_extra(
  p_extra_id     uuid,
  p_from_year    integer,
  p_performed_by uuid
)
returns void as $$
declare
  e public.leave_allowance_extras;
begin
  select * into e from public.leave_allowance_extras where id = p_extra_id;
  if not found then
    raise exception 'That extra no longer exists.';
  end if;

  if e.from_year >= p_from_year then
    delete from public.leave_allowance_extras where id = p_extra_id;
  else
    update public.leave_allowance_extras
    set to_year = p_from_year - 1
    where id = p_extra_id;
  end if;

  insert into public.leave_audit_log
    (user_id, leave_type_id, year, action, days_affected, new_total_days, performed_by, note)
  values
    (e.user_id, e.leave_type_id, p_from_year, 'adjusted', -e.days,
     public.standard_allowance_total(e.user_id, e.leave_type_id, p_from_year), p_performed_by,
     'Removed extra days from ' || p_from_year || ' onwards: ' || e.reason);
end;
$$ language plpgsql;

-- Sets the base (before extras) for one person / type / year,
-- e.g. part-time or pro-rata. Not needed for extra days.
create or replace function public.set_allowance_base(
  p_user_id       uuid,
  p_leave_type_id uuid,
  p_year          integer,
  p_base_days     numeric,
  p_performed_by  uuid,
  p_note          text
)
returns void as $$
declare
  v_old numeric;
begin
  select la.base_days into v_old
  from public.leave_allowances la
  where la.user_id = p_user_id and la.leave_type_id = p_leave_type_id and la.year = p_year
    and coalesce(la.notes, '') not like 'Rollover from%';
  if not found then
    raise exception 'No allowance for that person, leave type and year.';
  end if;

  update public.leave_allowances la
  set base_days = p_base_days
  where la.user_id = p_user_id and la.leave_type_id = p_leave_type_id and la.year = p_year
    and coalesce(la.notes, '') not like 'Rollover from%';

  insert into public.leave_audit_log
    (user_id, leave_type_id, year, action, days_affected, new_total_days, performed_by, note)
  values
    (p_user_id, p_leave_type_id, p_year, 'adjusted', p_base_days - v_old,
     public.standard_allowance_total(p_user_id, p_leave_type_id, p_year), p_performed_by,
     'Base changed from ' || v_old || ' to ' || p_base_days || ' days'
       || coalesce(': ' || nullif(trim(p_note), ''), ''));
end;
$$ language plpgsql;


-- -------------------------------------------------------------
-- 5. sync_leave_type_allowances() now moves the base
-- -------------------------------------------------------------
-- Same idea as migration_16, but compares and updates base_days,
-- so someone on 20 + 2 extra moves to 22 + 2 when the default goes
-- from 20 to 22. status:
--   update    base is p_old_days and will be / was changed
--   overused  base is p_old_days but the new total would be below
--             days already used; left
--   custom    base differs from p_old_days (e.g. pro-rata); left
-- Rows already on the new base aren't returned.
-- -------------------------------------------------------------
drop function if exists public.sync_leave_type_allowances(uuid, integer, numeric, uuid, boolean);

create function public.sync_leave_type_allowances(
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
  base_days  numeric,
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
    raise exception 'This leave type has no days / year set.';
  end if;

  for r in
    select la.id, la.user_id, u.full_name, la.year, la.base_days, la.total_days, la.used_days
    from public.leave_allowances la
    join public.users u on u.id = la.user_id
    where la.leave_type_id = p_leave_type_id
      and la.year >= p_from_year
      and coalesce(la.notes, '') not like 'Rollover from%'
      and u.deleted_at is null
      and la.base_days is distinct from v_new_days
    order by la.year, u.full_name
  loop
    user_id    := r.user_id;
    full_name  := r.full_name;
    year       := r.year;
    base_days  := r.base_days;
    total_days := r.total_days;
    used_days  := r.used_days;

    if r.base_days is distinct from p_old_days then
      status := 'custom';
    elsif r.total_days - r.base_days + v_new_days < r.used_days then
      status := 'overused';
    else
      status := 'update';
      if p_apply then
        update public.leave_allowances la set base_days = v_new_days where la.id = r.id;

        insert into public.leave_audit_log
          (user_id, leave_type_id, year, action, days_affected, new_total_days, performed_by, note)
        values
          (r.user_id, p_leave_type_id, r.year, 'adjusted', v_new_days - p_old_days,
           r.total_days - r.base_days + v_new_days, p_performed_by,
           v_type || ' changed from ' || p_old_days || ' to ' || v_new_days || ' days');
      end if;
    end if;

    return next;
  end loop;
end;
$$ language plpgsql;


-- -------------------------------------------------------------
-- 6. Earlier one-off grants
-- -------------------------------------------------------------
-- Before this migration, extra days were added to the total, so
-- they're now part of the base. List this holiday year's
-- allowances whose base isn't the default for that person (role
-- rule, else company default). To re-record one: Allowances ->
-- Adjust, set the base back to the default and add the difference
-- as an extra with its reason. Nothing is changed here.
-- -------------------------------------------------------------
do $$
declare
  r record;
  v_year integer := public.get_holiday_year_label(current_date);
begin
  for r in
    select u.full_name, lt.name as leave_type, la.year, la.base_days,
           coalesce(re.default_days, lt.max_days_per_year) as default_days
    from public.leave_allowances la
    join public.users u        on u.id = la.user_id
    join public.leave_types lt on lt.id = la.leave_type_id
    left join public.leave_type_entitlements re
      on re.leave_type_id = la.leave_type_id and re.role = u.role
    where la.year >= v_year
      and coalesce(la.notes, '') not like 'Rollover from%'
      and u.deleted_at is null
      and coalesce(re.default_days, lt.max_days_per_year) is not null
      and la.base_days is distinct from coalesce(re.default_days, lt.max_days_per_year)
    order by la.year, u.full_name, lt.name
  loop
    raise notice '% (%): % base is %, default is %',
      r.full_name, r.year, r.leave_type, r.base_days, r.default_days;
  end loop;
end;
$$;
