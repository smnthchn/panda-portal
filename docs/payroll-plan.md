# Timesheets & payroll plan

Agreed with Sam on 2026-09-28. Phase 1 is built and live, and CLAUDE.md
(Clock → Pay periods and approval) describes it. This file holds what's
agreed but not built yet.

## Scope

The portal produces **hours Sam can trust** and an **estimated gross** that
staff can see. It handles **no taxes, no deductions and no QuickBooks
integration.** Sam types everything into QBO by hand, because QBO payroll is
unreliable: its "correct" stat-holiday method leaves the hours out of the
total, so the T4 hours come out wrong. The export is for her own records.

## Phase 2: positions, rates, pay timeline

- A Positions list. Each person holds one or more positions, and each
  position has a dated rate history. A raise is a new row, never an edit.
  Each person also has a main position.
- **The schedule decides the position.** Shifts get a position picker, in
  both the store and event schedulers. Punches follow the scheduled shift
  they match. Unscheduled punches go to the person's main position. The boss
  can change the position of a worked shift during review.
- A timeline on the Staff page:
  - automatic entries: first day worked (from the first punch),
    anniversaries, rate changes and position changes;
  - manual entries: bonus (amount + note), job change, note.
- **Staff see their own** positions, rates and timeline, read-only. That
  includes bonuses and notes. If Sam wants some entries private, add an
  "only I can see this" tick box.
- The export gains position, rate, and rate × hours columns.

## Phase 3: estimated gross

- Hours × rate for each position, plus **stat holiday pay** and **stat
  premium**. Sam uses **Option B**: holiday pay plus 1.5× for hours worked on
  the holiday, with no substitute day. The estimate includes no vacation pay,
  no overtime and no bonuses.
- Holiday pay follows the Ontario ESA: regular wages in the 4 work weeks
  (Mon–Sun) before the holiday's own week, ÷ 20. Phase 1 already works this
  out in hours (`holidayWindow()`, the last-and-first check), so Phase 3
  prices those hours. Rates need backdating at least 4 weeks for the first
  holiday to come out right.
- The export shows holiday pay both as dollars and as equivalent hours,
  included in total hours.
- Staff see it **live** on a My pay page, labelled "Estimate" and updating
  after each shift. The boss sees it in Timesheets too.
- Before staff see it, work out one holiday period by hand and check it
  against the portal.
