# Leave Management

A small, self-contained leave management app for small teams. Employees request leave, managers and admins approve and manage allowances, and everyone can see a team-wide calendar of approved time off.

Built as a React single-page app on top of Supabase. No custom backend — the browser talks to Supabase directly, with Row Level Security doing the access control.

## Stack

- **React 18** + **Vite** for the frontend
- **Supabase** for Postgres, auth, and RLS
- **Vercel** for hosting (any static host works, Vercel just auto-detects Vite)

## Features

- Email + password sign-in via Supabase Auth, with password-reset flow.
- **My leave** — employees see their balances per leave type, request leave (with a live business-day count), and cancel pending requests.
- **Team calendar** — everyone signed in can see approved leave across the team, grouped by department. Two views: a Gantt-style timeline (rows = people, cols = days) and a traditional 7-column month grid. Filter by department or leave type.
- **Admin** (managers + admins only) — manage leave types, role-based entitlements, and per-person allowances. Includes RPCs for seeding annual allowances and adjusting individual balances.

## Project structure

```
leave-management/
├── package.json
├── vite.config.js
├── index.html
├── .gitignore
├── .env.example
├── db/
│   └── migration_04_calendar.sql      # adds users.department, RLS, index
└── src/
    ├── main.jsx                        # React entry point
    ├── App.jsx                         # Auth gate + tab router
    ├── lib/
    │   └── supabase.js                 # Single shared Supabase client
    ├── hooks/
    │   └── useAuth.js                  # Session + profile lookup
    └── components/
        ├── Login.jsx
        ├── ResetPassword.jsx           # Reset / invite: 6-digit code + new password
        ├── LeaveUserPanel.jsx
        ├── LeaveAdminPanel.jsx
        └── LeaveCalendar.jsx
```

## Local development

Requires Node 18+.

```bash
npm install
cp .env.example .env.local
# edit .env.local — paste in your Supabase project URL and anon key
npm run dev
```

The app opens at <http://localhost:5173>.

### Environment variables

| Name | Where to find it |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API → `anon` `public` key |

The `anon` key is browser-safe — RLS is what protects your data, not the key.

## Database setup

This app expects the leave-management schema (`users`, `leave_types`, `leave_type_entitlements`, `leave_allowances`, `leave_requests`) along with two views (`v_leave_balances`, `v_pending_requests`) and two RPC functions (`seed_annual_allowances`, `adjust_allowance`).

Migration order:

1. **migration_01** — base schema (tables + views + RPC functions).
2. **migration_02** — triggers for allowance deduction on approval, business-day calculation, and overuse prevention.
3. **migration_03** — views and RPCs (seed, adjust).
4. **migration_04_calendar.sql** — *included in this repo at `db/`*. Adds `users.department`, an RLS policy that lets every signed-in user read approved leave (so the team calendar populates), and a performance index on `leave_requests(status, start_date, end_date)`.

Run migration_04 in the Supabase SQL editor. It's defensive — checks each table exists before touching it and reports each step in the Notices panel.

### After migrating

Backfill the `department` column so the team calendar groups people meaningfully:

```sql
update public.users set department = 'Engineering' where full_name = 'Sarah Johnson';
update public.users set department = 'Design'      where full_name = 'Priya Nair';
-- …or do it inline via the Supabase Table Editor
```

## Adding users

There's no public sign-up form — admins create accounts.

1. Supabase dashboard → **Authentication** → **Users** → **Invite user**. Enter the email; they'll get a link to set a password.
2. Insert a matching row in `public.users` with the same `id` as the new `auth.users.id`. (If your `migration_01` includes a trigger that does this automatically, skip this step.)

```sql
insert into public.users (id, full_name, role, department)
values ('<auth-user-uuid>', 'Sarah Johnson', 'employee', 'Engineering');
```

## Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel: **New Project → Import Git Repository → pick the repo**. Vercel auto-detects Vite (build: `vite build`, output: `dist`).
3. **Project → Settings → Environment Variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for **Production**, **Preview**, and **Development**. Redeploy.
4. In Supabase: **Authentication → URL Configuration**:
   - **Site URL** = your Vercel production domain.
   - **Redirect URLs** = your production URL plus `https://*.vercel.app/*` if you want preview deployments to handle auth flows.
5. In Supabase: set up password-reset codes — see *Password reset & invites* below.

That's it. There are no Vercel serverless functions in this project — it's a pure static SPA that talks to Supabase from the browser.

## Password reset & invites

Password resets and invites use a **6-digit code** sent by email, not a link. Links get opened (and used up) by email security scanners such as Outlook Safe Links before the person clicks them. A code can't be used up that way, and it also works when the email is read on a phone but ComCal is open on a desktop.

- **Forgot password?** Enter your email → get a code → enter the code plus your new password (twice, at least 8 characters) → signed in.
- **Have an invite code?** For new starters invited from the Supabase dashboard. Enter your email, the code from the invite and a password. If the invite has expired, the screen offers to send a normal reset code instead.

**Supabase setup (one-off):**

1. **Authentication → Providers → Email → Email OTP Length** = `6`. (Email OTP Expiration controls how long codes last; the default is 1 hour.)
2. **Authentication → Email Templates → Reset Password**: replace the link with the code, e.g.

   ```html
   <h2>Reset your ComCal password</h2>
   <p>Your code is:</p>
   <p style="font-size:24px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>Enter it on the ComCal sign-in page under "Forgot password?". It expires in 1 hour.</p>
   <p>If you didn't ask for this, you can ignore this email.</p>
   ```

3. **Authentication → Email Templates → Invite user**: same idea, e.g.

   ```html
   <h2>You've been invited to ComCal</h2>
   <p>Go to {{ .SiteURL }}, click "Have an invite code?" and enter:</p>
   <p style="font-size:24px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   ```

Remove `{{ .ConfirmationURL }}` from both templates. If it's left in, clicking it signs the person in without setting a password.

## Roles

The app reads `public.users.role` and routes the UI accordingly:

| Role | Sees |
| --- | --- |
| `employee` | My leave + Team calendar |
| `manager` | My leave + Team calendar + Admin |
| `admin` | My leave + Team calendar + Admin |

All write actions on the admin tab require RLS policies that allow the role to perform them — make sure your `leave_types`, `leave_type_entitlements`, and `leave_allowances` tables have appropriate `INSERT`/`UPDATE`/`DELETE` policies for managers and admins.

## Common issues

**"Account not linked" after sign-in.** The `auth.users` row exists but there's no matching row in `public.users` for that id. Insert one (see *Adding users* above).

**Team calendar is empty for non-admins.** RLS is hiding rows. Run `migration_04_calendar.sql` — its policy lets every authenticated user see approved leave.

**Manager toggle on a leave type doesn't save.** Likely no RLS `UPDATE` policy on `leave_types` for the `manager`/`admin` role. Add one in your Supabase dashboard.

**Departments all show "Unassigned".** The `department` column is added but empty. Backfill it (see *After migrating*).

## License

Private — internal use.
