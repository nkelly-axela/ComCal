-- =============================================================
-- migration_06_rollover_and_public_holidays.sql
-- Adds: rollover rules + public holidays table
-- Run AFTER migration_01 through migration_05
-- =============================================================


-- -------------------------------------------------------------
-- 1. Extend company_settings with rollover keys
--    Keys stored:
--      holiday_year_start      MM-DD      (existing)
--      rollover_max_days       numeric    max days staff can carry over
--      rollover_expiry_months  integer    months after new year before they expire
--      rollover_enabled        boolean    master on/off switch
-- -------------------------------------------------------------
-- company_settings already exists from migration_03/04.
-- The upserts below seed sensible UK defaults (5 days, 3 months).

insert into public.company_settings (key, value) values
  ('rollover_enabled',       'true'),
  ('rollover_max_days',      '5'),
  ('rollover_expiry_months', '3')
on conflict (key) do nothing;


-- -------------------------------------------------------------
-- 2. public_holidays table
--    Stores bank holidays for England & Wales (and optionally
--    Scotland / Northern Ireland via the region column).
--    Populated by the admin panel via the gov.uk API:
--      https://www.gov.uk/bank-holidays.json
-- -------------------------------------------------------------
create table if not exists public.public_holidays (
  id          uuid primary key default uuid_generate_v4(),
  date        date        not null,
  name        text        not null,
  region      text        not null default 'england-and-wales',
                          -- 'england-and-wales' | 'scotland' | 'northern-ireland'
  notes       text,
  bunting     boolean     default false,
  created_at  timestamptz default now(),
  unique (date, region)
);

-- RLS
alter table public.public_holidays enable row level security;

create policy "Authenticated users can read public holidays"
  on public.public_holidays for select
  using (auth.role() = 'authenticated');

create policy "Admins manage public holidays"
  on public.public_holidays for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin', 'manager')
    )
  );

-- Index for fast date-range lookups (used by calculate_leave_days)
create index if not exists public_holidays_date_region_idx
  on public.public_holidays (date, region);


-- -------------------------------------------------------------
-- 3. Extend company_settings — ensure table + key column exist
-- -------------------------------------------------------------
-- Already created in migration_03. Just confirm the index.
create index if not exists company_settings_key_idx
  on public.company_settings (key);


-- -------------------------------------------------------------
-- 4. Updated calculate_leave_days — now excludes public holidays
--    Replaces the version from migration_02 which only skipped
--    weekends. This version also skips any date in public_holidays
--    matching the given region.
-- -------------------------------------------------------------
create or replace function public.calculate_leave_days(
  p_start   date,
  p_end     date,
  p_region  text default 'england-and-wales'
)
returns numeric as $$
declare
  v_days    numeric := 0;
  v_current date    := p_start;
begin
  while v_current <= p_end loop
    -- Skip weekends
    if extract(dow from v_current) not in (0, 6) then
      -- Skip public holidays
      if not exists (
        select 1 from public.public_holidays
        where date = v_current and region = p_region
      ) then
        v_days := v_days + 1;
      end if;
    end if;
    v_current := v_current + interval '1 day';
  end loop;
  return v_days;
end;
$$ language plpgsql stable;


-- -------------------------------------------------------------
-- 5. process_year_end_rollover(year, performed_by)
--    Call at the end of the leave year to:
--      a. Calculate each user's unused days
--      b. Cap at rollover_max_days from company_settings
--      c. Create a rollover allowance row for the new year
--         with expiry_date set to rollover_expiry_months ahead
--      d. Log everything to leave_audit_log
--
--    Returns a summary table so admins can review before committing.
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

  v_expiry_date := make_date(v_to_year, 1, 1) + (v_expiry_months || ' months')::interval;

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
    if exists (
      select 1 from public.leave_allowances
      where user_id = v_rec.user_id and leave_type_id = v_rec.leave_type_id
        and year = v_to_year and notes like 'Rollover from%'
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
    on conflict (user_id, leave_type_id, year) do nothing;

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
-- 6. Add optional columns to leave_allowances for rollover tracking
-- -------------------------------------------------------------
alter table public.leave_allowances
  add column if not exists notes       text,
  add column if not exists expiry_date date;


-- -------------------------------------------------------------
-- VERIFICATION
-- -------------------------------------------------------------
select key, value from public.company_settings
  where key in ('rollover_enabled','rollover_max_days','rollover_expiry_months')
  order by key;

select table_name from information_schema.tables
  where table_schema = 'public' and table_name = 'public_holidays';
