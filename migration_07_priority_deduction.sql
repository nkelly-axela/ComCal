-- =============================================================
-- migration_07_priority_deduction.sql
-- Fixes:
--   1. deduct_leave_allowance() / restore_leave_allowance() were
--      matching on (user_id, leave_type_id, year) without
--      distinguishing rows. When a user has both a standard
--      allowance row AND a rollover row for the same year, the
--      old UPDATE matched both rows and added the FULL
--      days_requested to each one's used_days independently
--      (i.e. a 5-day booking deducted 5 from rollover AND 5 from
--      the standard row -- 10 days removed for a 5-day booking).
--   2. prevent_overuse() summed remaining days across all rows
--      for the year, including expired rollover rows, so an
--      expired rollover balance could still "count" toward
--      whether a request was approvable.
--   3. process_year_end_rollover() (migration_06) calculated the
--      rollover expiry date from a hardcoded 1 January rather
--      than the admin-configured holiday_year_start, which is
--      wrong for any company (like this one) whose holiday year
--      doesn't start on 1 Jan.
--
-- New priority order on approval (use-it-or-lose-it first):
--   1. Unexpired rollover bucket, up to min(days_requested, rollover remaining)
--   2. Anything left over comes from the current year's standard allowance
--   A booking is bucketed in full based on its start_date (consistent
--   with get_holiday_year_label, which already buckets requests by
--   start_date) -- a booking spanning the rollover expiry date is
--   NOT split day-by-day, it's treated as one booking.
--
-- Run AFTER migration_06_rollover_holidays.sql
-- =============================================================


-- -------------------------------------------------------------
-- 1. Track which portion of a request came from rollover, so a
--    later restore (rejection/cancellation) can credit the exact
--    same buckets it was taken from, rather than guessing.
-- -------------------------------------------------------------
alter table public.leave_requests
  add column if not exists rollover_days_used numeric not null default 0;


-- -------------------------------------------------------------
-- 2. deduct_leave_allowance() -- now splits across buckets
-- -------------------------------------------------------------
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

    -- Find an unexpired rollover bucket for this user/type/year.
    -- "Unexpired" is judged against the leave's own start_date.
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

    -- Anything left over comes from the current year's standard allowance
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

    -- Record the split so restore_leave_allowance can reverse it
    -- from the exact same buckets later. This is a second UPDATE
    -- on leave_requests -- safe from recursion because it doesn't
    -- touch the status column, so neither this trigger (status
    -- unchanged) nor prevent_overuse (BEFORE UPDATE OF status
    -- only) fire again as a result.
    update public.leave_requests
    set rollover_days_used = v_rollover_take
    where id = new.id;

  end if;
  return new;
end;
$$ language plpgsql;


-- -------------------------------------------------------------
-- 3. restore_leave_allowance() -- reverses the exact split that
--    was recorded at deduction time, rather than a flat
--    subtraction against every matching row.
-- -------------------------------------------------------------
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


-- -------------------------------------------------------------
-- 4. prevent_overuse() -- excludes expired rollover rows from
--    the "remaining" total used for the approval-time check, so
--    it matches what deduct_leave_allowance can actually draw on.
-- -------------------------------------------------------------
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


-- -------------------------------------------------------------
-- 5. process_year_end_rollover() -- expiry date now anchored to
--    the admin-configured holiday_year_start instead of 1 Jan.
--    Same parsing approach as get_holiday_year_label, kept
--    inline here to avoid changing that function's signature.
-- -------------------------------------------------------------
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

  -- Read rollover settings
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

  -- Anchor expiry to the admin-configured holiday year start
  -- (same parsing as get_holiday_year_label), not 1 January.
  select value into v_hys_raw
    from public.company_settings where key = 'holiday_year_start';
  v_hys_raw := coalesce(v_hys_raw, '01-01');
  v_month   := split_part(v_hys_raw, '-', 1)::integer;
  v_day     := split_part(v_hys_raw, '-', 2)::integer;

  v_year_start  := make_date(v_to_year, v_month, v_day);
  v_expiry_date := v_year_start + (v_expiry_months || ' months')::interval;

  -- Loop every allowance for the from_year
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
  loop
    v_unused := greatest(0, v_rec.total_days - v_rec.used_days)::numeric;
    v_rolled := least(v_unused, v_max_days);

    -- Skip if nothing to roll
    if v_rolled = 0 then
      return query select v_rec.user_id, v_rec.full_name, v_rec.leave_type_id, v_rec.leave_type_name,
        v_unused, 0::numeric, v_expiry_date, true, 'No unused days to roll over';
      continue;
    end if;

    -- Skip if rollover allowance already exists for this user+type+year
    -- (aliased to la2 to avoid ambiguity with the user_id/leave_type_id
    -- output columns of this RETURNS TABLE function)
    if exists (
      select 1 from public.leave_allowances la2
      where la2.user_id = v_rec.user_id and la2.leave_type_id = v_rec.leave_type_id
        and la2.year = v_to_year and la2.notes like 'Rollover from%'
    ) then
      return query select v_rec.user_id, v_rec.full_name, v_rec.leave_type_id, v_rec.leave_type_name,
        v_unused, v_rolled, v_expiry_date, true, 'Rollover row already exists for ' || v_to_year;
      continue;
    end if;

    -- Insert rollover allowance row (separate from the main seeded allowance)
    insert into public.leave_allowances
      (user_id, leave_type_id, total_days, used_days, year, notes, expiry_date)
    values
      (v_rec.user_id, v_rec.leave_type_id, v_rolled, 0, v_to_year,
       'Rollover from ' || p_from_year, v_expiry_date)
    on conflict do nothing;

    -- Audit log
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


-- -------------------------------------------------------------
-- VERIFICATION
-- -------------------------------------------------------------
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'leave_requests'
  and column_name = 'rollover_days_used';

select tgname, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'public.leave_requests'::regclass
  and not tgisinternal;
