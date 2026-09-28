# Handoff

Session notes. Durable decisions go in CLAUDE.md once built; this file is
where we are and what's next.

## Timesheets & payroll (started 2026-09-28)

Scope agreed with Sam: the portal produces **hours she can trust** and an
estimated gross for staff to see. **No taxes, no deductions, no QuickBooks
integration** — Sam types everything into QBO by hand because QBO payroll is
glitchy (e.g. its "correct" stat-holiday method leaves the hours out of the
total, so the T4 hours come out wrong). The export is for her own records.

### Phase 1 — pay periods, flags, approval, export (built locally 2026-09-28, not deployed)

- Periods are fixed: **1st–15th** and **16th–month end**. Timesheets opens on
  the current period with ‹ › stepping. Periods are decided in Toronto time,
  server-side; a shift belongs to the day it clocked in.
- Flags per person: no clock-out, break never ended, 16h+ shift, scheduled
  break not taken, scheduled shift with no punches (no-show). No clock-out and
  an open break must be fixed; the others can be dismissed with a reason.
- **Only the boss approves**, one person at a time, plus "approve everyone
  with no open flags". Approval locks those punches; fixing them needs an
  unlock, and unlocks are kept as a log.
- Excel export (SheetJS from cdnjs, built in the browser): summary sheet,
  punch-detail sheet with fixes, and an approval log. Stat-holiday hours worked
  get their own column.

### Phase 2 — positions, rates, pay timeline

- A Positions list; each person holds one or more positions, each with a
  dated rate history (a raise is a new row, never an edit) and a main position.
- **The schedule decides the position**: shifts get a position picker; punches
  follow their matching shift; unscheduled punches go to the main position;
  the boss can change a worked shift's position during review.
- Timeline on the Staff page — automatic (first day worked, anniversaries,
  rate/position changes) plus manual (bonus, job change, note).
- **Staff see their own** positions, rates and timeline, read-only.

### Phase 3 — estimated gross

- Hours × rate per position, **stat holiday pay** and **stat premium**.
  Sam uses **Option B**: holiday pay plus 1.5× for hours worked on the
  holiday, no substitute day. No vacation pay, no overtime, no bonuses in the
  estimate.
- Holiday pay (Ontario ESA): regular wages in the 4 work weeks before the
  holiday's work week ÷ 20. Only the 9 statutory holidays (civic holiday is
  `statutory: false`). **Last-and-first rule** checked against the schedule
  and flagged; the boss can override ("counts anyway"). Rates must be
  backdated at least 4 weeks for the first holiday to come out right.
- Export shows holiday pay as dollars **and** equivalent hours (÷ rate),
  included in total hours, for honest T4 hours.
- Staff see it **live** on a My pay page, labelled "Estimate", updating
  after each shift.
- Hand-check a holiday period against the portal before staff see it.

Added to Phase 1 (same session): **stat holiday hours** (lookback ÷ 20,
Mon–Sun work weeks, last-and-first check with Counts / Doesn't count) and
**premium pay hours** (worked on the holiday) as their own columns, with
Regular + Premium + Stat Holiday = Total; and **staff can see and answer
their flags** (note + time) from the Clock page, with a one-tap "Use their
time" for the boss. Staff notes stay visible on the shift (and in the
export) after the flag is fixed. Correction given to Sam: Labour Day 2026's lookback is
Aug 10 – Sep 6 (the holiday is a Monday, so its own week starts that day),
not Aug 3–30 as first said.

Phase 1 status: migration `0047_timesheets.sql`, `src/routes/timesheets.js`,
`public/timesheets.js`, lock added to the clock fix. 182 tests pass. Tried on
local test data: fix, dismiss, approve, approve-all, lock, changed-after-
approval, unlock, export contents. **Not committed, not migrated remote, not
deployed.** Local D1 has seeded test punches for Aug–Sep 2026 and local
session rows `local-ts-test-session` (Sam) and `local-ts-staff-session`
(Test Staff), local only. Local D1 got 0047's later additions by hand
(`outcome` column, responses table), since 0047 was already applied there.

## Open items

- Sam to try Phase 1 locally, then decide on commit + deploy (migration 0047
  goes remote first; follow the three-step deploy in CLAUDE.md).
- Phase 2 next, after Phase 1 is live and used for one payday.

- Local `master` is 35 commits ahead of `origin/master` (found 2026-09-28).
  GitHub is supposed to be the source of truth — ask Sam before pushing.
- Uncommitted from an earlier session: `.gitignore` (design bundles) and a
  small `CLAUDE.md` edit.
