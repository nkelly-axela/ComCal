-- =============================================================
-- reference_leave_rollover_logic.sql
--
-- Canonical reference for how ComCal calculates leave balances,
-- rollover priority, and rollover eligibility. This consolidates
-- the fixes applied across migrations 07-10 into their final,
-- correct state, so the system's actual behaviour can be read
-- from one place instead of pieced together from incremental
-- patch files.
--
-- Safe to re-run on the live database -- every statement is
-- idempotent (CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS, etc).
-- Also safe to run on a fresh database directly after
-- migration_06_rollover_holidays.sql, since it includes
-- get_holiday_year_label() -- a function that existed live in
-- Supabase but was never committed to this repo until now.
--
-- This file does NOT include one-time historical data fixes
-- (the balance recompute, the rollover forfeiture for ineligible
-- leave types, or the three specific hourly-request corrections).
-- Those were point-in-time remediations already applied to
-- production and are preserved separately as
-- migration_09_recompute_balances.sql, the forfeiture step inside
-- migration_08_rollover_eligibility.sql, and
-- migration_11_fix_three_hourly_rows.sql, for audit history.
--
-- Last verified against production: 17 June 2026.
--
-- CHANGELOG (what this fixes, relative to the original system):
--   1. Rollover is consumed before the current year's standard
--      allowance, up to whichever is smaller of (days requested,
--      rollover remaining). A booking is bucketed by its
--      start_date alone, even if it spans the rollover expiry
--      date -- no day-by-day splitting.
--   2. Expired rollover (judged against the booking's own
--      start_date) is excluded both from deduction and from the
--      approval-time balance check.
--   3. Cancelling/rejecting a previously-approved booking credits
--      back to the exact buckets it was originally drawn from
--      (tracked via leave_requests.rollover_days_used), not a
--      flat undo against every matching row.
--   4. Rollover expiry dates anchor to the admin-configured
--      holiday_year_start, not a hardcoded 1 January.
--   5. Rollover only applies to leave types explicitly marked
--      rollover_eligible (admin-togglable per type), not every
--      leave type indiscriminately.
--   6. Hourly leave requests (the "Request by the hour" toggle)
--      correctly deduct a fraction of a day (hours / 8) instead
--      of being charged as a full day regardless of duration.
-- =============================================================


-- =============================================================
-- SECTION 1 -- Schema
-- =============================================================

-- Tracks how much of an approved request was drawn from rollover,
-- so cancellation/rejection can credit back the correct bucket.
alter table public.leave_requests
  add column if not exists rollover_days_used numeric not null default 0;

-- Per-leave-type control over whether unused days roll over at
-- year-end. Editable from the admin Leave types tab.
alter table public.leave_types
  add column if not exists rollover_eligible boolean not null default false;

-- Default: only Annual Leave rolls over. Guarded so it only
-- applies on a genuinely fresh setup -- if any leave type has
-- already been configured (via the admin toggle or a prior run
-- of this file), it won't silently override that choice.
do $$
begin
  if not exists (select 1 from public.leave_types where rollover_eligible = true) then
    update public.leave_types
    set rollover_eligible = true
    where lower(trim(name)) = 'annual leave';
  end if;
end;
$$;


-- =============================================================
-- SECTION 2 -- Core functions
-- =============================================================

-- Unchanged from its live production version. Included here
-- because it was never committed elsewhere in this repo --
-- every other function below depends on it.
create or replace function public.get_holiday_year_label(p_date date)
returns integer
language plpgsql
stable
as $function$
declare
  v_hys_raw   text;
  v_month     integer;
  v_day       integer;
  v_candidate date;
begin
  select value into v_hys_raw
  from public.company_settings
  where key = 'holiday_year_start';
  v_hys_raw := coalesce(v_hys_raw, '01-01');
  v_month   := split_part(v_hys_raw, '-', 1)::integer;
  v_day     := split_part(v_hys_raw, '-', 2)::integer;
  v_candidate := make_date(extract(year from p_date)::integer, v_month, v_day);
  if p_date >= v_candidate then
    return extract(year from v_candidate)::integer;
  else
    return extract(year from v_candidate)::integer - 1;
  end if;
end;
$function$;


-- Derives days_requested. For full-day bookings, counts working
-- days excluding weekends and public holidays (unchanged from
-- migration_06's calculate_leave_days). For hourly bookings
-- ("Request by the hour" in the UI), derives a fraction of an
-- 8-hour day instead of letting the full-day calculation
-- silently override hours_requested.
create or replace function public.set_leave_days()
returns trigger as $$
begin
  if new.hours_requested is not null then
    new.days_requested := round(new.hours_requested / 8.0, 4);
  else
    new.days_requested := public.calculate_leave_days(
      new.start_date,
      new.end_date,
      'england-and-wales'
    );
  end if;
  return new;
end;
$$ language plpgsql;


-- Fires on approval. Draws from an unexpired rollover bucket
-- first (up to its remaining capacity), then the current year's
-- standard allowance for anything left over. Records the split
-- on the request itself for accurate restoration later.
create or replace function public.deduct_leave_allowance()
returns trigger as $$
declare
  v_year               int;
  v_to_deduct          numeric;
  v_rollover_id        uuid;
  v_rollover_remaining numeric;
  v_rollover_take      numeric := 0;
  v_standard_id        uuid;
begin
  if (new.status = 'approved' and old.status is distinct from 'approved') then

    v_year      := public.get_holiday_year_label(new.start_date);
    v_to_deduct := new.days_requested;

    select id, greatest(0, total_days - used_days)
    into v_rollover_id, v_rollover_remaining
    from public.leave_allowances
    where user_id       = new.user_id
      and leave_type_id = new.leave_type_id
      and year          = v_year
      and notes like 'Rollover from%'
      and (expiry_date is null or new.start_date <= expiry_date)
    order by expiry_date asc nulls last
    limit 1;

    if v_rollover_id is not null and v_rollover_remaining > 0 then
      v_rollover_take := least(v_to_deduct, v_rollover_remaining);

      update public.leave_allowances
      set used_days = used_days + v_rollover_take
      where id = v_rollover_id;

      v_to_deduct := v_to_deduct - v_rollover_take;
    end if;

    if v_to_deduct > 0 then
      select id into v_standard_id
      from public.leave_allowances
      where user_id       = new.user_id
        and leave_type_id = new.leave_type_id
        and year          = v_year
        and (notes is null or notes not like 'Rollover from%')
      order by id
      limit 1;

      if v_standard_id is not null then
        update public.leave_allowances
        set used_days = used_days + v_to_deduct
        where id = v_standard_id;
      end if;
    end if;

    update public.leave_requests
    set rollover_days_used = v_rollover_take
    where id = new.id;

  end if;
  return new;
end;
$$ language plpgsql;


-- Mirror of deduct_leave_allowance. Fires when a previously
-- approved request leaves approved status (rejection,
-- cancellation). Reverses the exact split recorded above, rather
-- than a flat subtraction against every matching allowance row.
create or replace function public.restore_leave_allowance()
returns trigger as $$
declare
  v_year         int;
  v_rollover_amt numeric;
  v_standard_amt numeric;
  v_rollover_id  uuid;
  v_standard_id  uuid;
begin
  if (old.status = 'approved' and new.status is distinct from 'approved') then

    v_year         := public.get_holiday_year_label(old.start_date);
    v_rollover_amt := coalesce(old.rollover_days_used, 0);
    v_standard_amt := old.days_requested - v_rollover_amt;

    if v_rollover_amt > 0 then
      select id into v_rollover_id
      from public.leave_allowances
      where user_id       = old.user_id
        and leave_type_id = old.leave_type_id
        and year          = v_year
        and notes like 'Rollover from%'
      order by id
      limit 1;

      if v_rollover_id is not null then
        update public.leave_allowances
        set used_days = greatest(0, used_days - v_rollover_amt)
        where id = v_rollover_id;
      end if;
    end if;

    if v_standard_amt > 0 then
      select id into v_standard_id
      from public.leave_allowances
      where user_id       = old.user_id
        and leave_type_id = old.leave_type_id
        and year          = v_year
        and (notes is null or notes not like 'Rollover from%')
      order by id
      limit 1;

      if v_standard_id is not null then
        update public.leave_allowances
        set used_days = greatest(0, used_days - v_standard_amt)
        where id = v_standard_id;
      end if;
    end if;

  end if;
  return new;
end;
$$ language plpgsql;


-- Fires before approval. Blocks the request if there isn't
-- enough remaining balance. Excludes expired rollover from the
-- "remaining" total, so it matches what deduct_leave_allowance
-- can actually draw on for this specific booking.
create or replace function public.prevent_overuse()
returns trigger as $$
declare
  v_remaining numeric;
  v_any_row   boolean;
  v_year      int;
begin
  v_year := public.get_holiday_year_label(new.start_date);

  select
    exists(
      select 1 from public.leave_allowances
      where user_id = new.user_id and leave_type_id = new.leave_type_id and year = v_year
    ),
    coalesce(sum(total_days - used_days), 0)
  into v_any_row, v_remaining
  from public.leave_allowances
  where user_id       = new.user_id
    and leave_type_id = new.leave_type_id
    and year          = v_year
    and (
      notes is null
      or notes not like 'Rollover from%'
      or expiry_date is null
      or new.start_date <= expiry_date
    );

  if not v_any_row then
    raise exception
      'No leave allowance found for this user, leave type, and holiday year %. '
      'Please ask an admin to set up the allowance before approving.', v_year;
  end if;

  if v_remaining < new.days_requested then
    raise exception
      'Insufficient leave allowance. Requested: % day(s), Remaining: % day(s).',
      new.days_requested, v_remaining;
  end if;

  return new;
end;
$$ language plpgsql;


-- Creates next year's rollover allowance rows at year-end. Only
-- processes leave types marked rollover_eligible, and anchors
-- the expiry date to the admin-configured holiday_year_start
-- rather than a hardcoded 1 January.
create or replace function public.process_year_end_rollover(
  p_from_year    integer,
  p_performed_by uuid default null
)
returns table (
  user_id         uuid,
  user_name       text,
  leave_type_id   uuid,
  leave_type_name text,
  unused_days     numeric,
  rolled_days     numeric,
  expiry_date     date,
  skipped         boolean,
  skip_reason     text
) as $$
declare
  v_enabled        boolean;
  v_max_days       numeric;
  v_expiry_months  integer;
  v_to_year        integer;
  v_hys_raw        text;
  v_month          integer;
  v_day            integer;
  v_year_start     date;
  v_expiry_date    date;
  v_rec            record;
  v_unused         numeric;
  v_rolled         numeric;
begin
  v_to_year := p_from_year + 1;

  select (value = 'true') into v_enabled
    from public.company_settings where key = 'rollover_enabled';
  if not v_enabled then
    raise exception 'Rollover is disabled in company settings.';
  end if;

  select value::numeric into v_max_days
    from public.company_settings where key = 'rollover_max_days';
  v_max_days := coalesce(v_max_days, 5);

  select value::integer into v_expiry_months
    from public.company_settings where key = 'rollover_expiry_months';
  v_expiry_months := coalesce(v_expiry_months, 3);

  select value into v_hys_raw
    from public.company_settings where key = 'holiday_year_start';
  v_hys_raw := coalesce(v_hys_raw, '01-01');
  v_month   := split_part(v_hys_raw, '-', 1)::integer;
  v_day     := split_part(v_hys_raw, '-', 2)::integer;

  v_year_start  := make_date(v_to_year, v_month, v_day);
  v_expiry_date := v_year_start + (v_expiry_months || ' months')::interval;

  for v_rec in
    select
      la.id          as allowance_id,
      la.user_id,
      u.full_name,
      la.leave_type_id,
      lt.name        as leave_type_name,
      la.total_days,
      la.used_days
    from public.leave_allowances la
    join public.users       u  on u.id  = la.user_id
    join public.leave_types lt on lt.id = la.leave_type_id
    where la.year = p_from_year
      and lt.rollover_eligible = true
  loop
    v_unused := greatest(0, v_rec.total_days - v_rec.used_days)::numeric;
    v_rolled := least(v_unused, v_max_days);

    if v_rolled = 0 then
      return query select v_rec.user_id, v_rec.full_name, v_rec.leave_type_id, v_rec.leave_type_name,
        v_unused, 0::numeric, v_expiry_date, true, 'No unused days to roll over';
      continue;
    end if;

    if exists (
      select 1 from public.leave_allowances la2
      where la2.user_id = v_rec.user_id and la2.leave_type_id = v_rec.leave_type_id
        and la2.year = v_to_year and la2.notes like 'Rollover from%'
    ) then
      return query select v_rec.user_id, v_rec.full_name, v_rec.leave_type_id, v_rec.leave_type_name,
        v_unused, v_rolled, v_expiry_date, true, 'Rollover row already exists for ' || v_to_year;
      continue;
    end if;

    insert into public.leave_allowances
      (user_id, leave_type_id, total_days, used_days, year, notes, expiry_date)
    values
      (v_rec.user_id, v_rec.leave_type_id, v_rolled, 0, v_to_year,
       'Rollover from ' || p_from_year, v_expiry_date)
    on conflict do nothing;

    insert into public.leave_audit_log
      (user_id, leave_type_id, year, action, days_affected, new_total_days, performed_by, note)
    values
      (v_rec.user_id, v_rec.leave_type_id, v_to_year, 'rollover',
       v_rolled, v_rolled, p_performed_by,
       v_rolled || ' days rolled over from ' || p_from_year || ', expires ' || v_expiry_date);

    return query select v_rec.user_id, v_rec.full_name, v_rec.leave_type_id, v_rec.leave_type_name,
      v_unused, v_rolled, v_expiry_date, false, null::text;
  end loop;
end;
$$ language plpgsql;


-- =============================================================
-- SECTION 3 -- Triggers
-- Re-creates the existing trigger bindings for idempotency
-- (e.g. rebuilding from migration_06 onward on a fresh database).
-- On the current production database these already exist and
-- point at the functions above -- this is a no-op there.
-- =============================================================

drop trigger if exists trg_set_leave_days on public.leave_requests;
create trigger trg_set_leave_days
  before insert or update on public.leave_requests
  for each row execute function set_leave_days();

drop trigger if exists trg_prevent_overuse on public.leave_requests;
create trigger trg_prevent_overuse
  before update of status on public.leave_requests
  for each row when (new.status = 'approved')
  execute function prevent_overuse();

drop trigger if exists trg_deduct_allowance on public.leave_requests;
create trigger trg_deduct_allowance
  after update on public.leave_requests
  for each row execute function deduct_leave_allowance();

drop trigger if exists trg_restore_allowance on public.leave_requests;
create trigger trg_restore_allowance
  after update on public.leave_requests
  for each row execute function restore_leave_allowance();


-- =============================================================
-- VERIFICATION
-- =============================================================
select name, rollover_eligible from public.leave_types order by name;

select tgname, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'public.leave_requests'::regclass
  and not tgisinternal;
