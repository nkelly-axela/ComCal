-- Run this in Supabase SQL editor to diagnose the auth issue
-- ============================================================

-- 1. Check the user row exists and has the right data
select id, full_name, email, role, department
from public.users
where id = 'd3dee5c0-f7c8-4d53-b5d2-6d28d16c827d';

-- 2. Check ALL RLS policies on public.users
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'users' and schemaname = 'public'
order by cmd, policyname;

-- 3. Confirm RLS is enabled on users table
select relname, relrowsecurity
from pg_class
where relname = 'users' and relnamespace = 'public'::regnamespace;

-- 4. FIX: Drop and recreate the select policy cleanly
drop policy if exists "Users can view own profile" on public.users;
drop policy if exists "Managers can view all users" on public.users;

-- Allow any authenticated user to read their own row
create policy "Users can view own profile"
  on public.users for select
  to authenticated
  using (auth.uid() = id);

-- Allow managers and admins to read all users
create policy "Managers can view all users"
  on public.users for select
  to authenticated
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
      and role in ('manager', 'admin')
    )
  );

-- 5. Verify policies after fix
select policyname, cmd, qual
from pg_policies
where tablename = 'users' and schemaname = 'public'
order by policyname;
