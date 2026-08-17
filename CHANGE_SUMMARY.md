# ComCal — Leave balance / rollover fixes (change summary)

Summary of the dashboard, rollover, and holiday-year work. Three parts: a frontend
code change (PR), a one-off data remediation (SQL run against production), and a
migration that prevents the issue recurring.

---

## 1. Frontend (PR — `LeaveUserPanel.jsx`, `LeaveAdminPanel-2.jsx`)

**Dashboard holiday-year / rollover display fix**
- The employee dashboard now derives the holiday year solely from the admin
  `holiday_year_start` setting (via `get_holiday_year_dates`), never from the
  calendar year. Balances load only once the holiday-year label is known;
  removed all `new Date().getFullYear()` fallbacks.
- Balance query changed to `.eq('year', holidayYear)`, returning exactly the two
  correct buckets (standard + active/expired rollover) and no longer pulling next
  year's carryover.
- Fixed a React key collision that let the standard and rollover Annual Leave
  cards render into each other (keyed on the allowance row id now).

**Admin employee search**
- Added a "Search employee…" bar to the **Audit log** tab (server-side, resolves
  the term to user ids and filters via the request join so pagination/counts stay
  correct) and the **Allowances** tab (client-side over the loaded rows).

_Delivery:_ edited directly in the GitHub web UI on a branch → PR → Vercel Preview
→ merge to `main` = production. No env/config changes.

---

## 2. Data remediation (one-off, run in Supabase SQL editor)

**Problem:** an older, pre-cap version of `process_year_end_rollover` had created
**12 rollover rows (12 employees) with `total_days = 20`** — far above the rollover
cap. This inflated available leave and split usage across buckets, making standard
Annual Leave cards read incorrectly (e.g. Cecille showed 11/9 instead of 11.5/8.5).

**Not a rounding issue:** day columns are `numeric`, fractions are stored intact,
and neither the admin nor employee views round — confirmed in the data.

**Fix applied (`remediate_rollovers_FINAL.sql`):**
- Each corrupt rollover row capped to `least(prior-year unused, rollover_max_days)`;
  any usage above the cap moved onto the person's standard row. Total days taken
  per person preserved — only re-bucketed.
- Nina Dlavlis's pro-rata standard row (14.8 total, 15 used) was 0.2 over from an
  already-taken booking; per instruction her total was raised to 15 to grant it.
- Ran inside one transaction with a strict whole-table guard (rolls back if
  anything is left over-cap or over-allocated).

**Result:** `over_cap_remaining = 0`, `overallocated_remaining = 0`,
`negative_rows = 0`. Spot-checked: Cecille 8.5 left, Marija rollover 6/0 +
Annual Leave 13/20, Nina 15/15.

---

## 3. Prevention (migration — `migration_12_enforce_rollover_cap.sql`)

Installs the corrected `process_year_end_rollover` so future year-end runs honor:
- **Max days** — `rolled = least(unused, rollover_max_days)` (hard cap).
- **Expiry** — anchored to `holiday_year_start + rollover_expiry_months`, not 1 Jan.
- **Eligibility / enable** — only `rollover_eligible` leave types; aborts if
  `rollover_enabled` is off.

Idempotent; no `UPDATE`/`DELETE` on `leave_allowances`, so it does **not** affect
existing/this-year data — it only changes what future rollover runs create.

---

## Outstanding
- Merge the frontend PR to deploy the dashboard + search changes.
- Optional belt-and-braces: run `reference_leave_rollover_logic.sql` (idempotent)
  to ensure the deduction/expiry triggers in production match the canonical logic.
- Consider committing the production-only DB objects (`v_leave_balances`,
  `get_holiday_year_dates`, `seed_annual_allowances`) to the repo so they're
  version-controlled.
