# Handoff: Panda Portal

## Open items
- [Claude] Build Phase 2 (positions, dated rates, position picker on shifts, pay timeline, read-only view for staff) as planned in `docs/payroll-plan.md` (added 2026-09-28; no longer waits on a payday, the app isn't in real use yet)

## Parked

---

## 2026-09-29 (mid-session note)
**Closed:** Decide whether `design/` goes in git (done: DESIGN-STATUS.md committed, the v1/v2 bundles stay ignored). Bump the Actions versions (done: checkout and setup-node v7, deploy passed). Sep 16–30 payday run and Thanksgiving hand check (dropped: the portal isn't used for real payroll yet, per Sam).


## 2026-09-28
**Done:**
- Timesheets now work in pay periods (1st–15th, 16th–end, Toronto time). They have flags (no clock-out, open break, 16h+ shift, missed scheduled break, no-show), approval by the boss per person or for everyone ready, locking with a logged unlock, and an Excel export for Sam's records (Summary, Shifts, Log).
- Stat holiday hours: the 4 Mon–Sun weeks before the holiday's week ÷ 20, held behind a last-and-first check that the boss decides (Counts / Doesn't count). Premium pay hours are the hours worked on the holiday. Regular + Premium + Stat Holiday = Total.
- Staff see and answer flags on their own hours from the Clock page, giving a note and a time. The boss has a one-tap "Use 7:45 PM" to apply it. Staff notes stay on the shift and in the export after the fix.
- Agreed Phase 2 and 3 (positions, rates, timeline, estimated gross, Option B) and wrote them into `docs/payroll-plan.md`.
- Deployed: migration 0047 on production (confirmed in d1_migrations), `wrangler deploy` (version b00379cc), pushed. The GitHub Deploy workflow passed on both pushes, so pushing to master now reliably deploys. The 35 old unpushed commits (all older than the Sep 4 deploy) went up with it, so GitHub matches production.

**Left off:** Phase 1 is live but hasn't been used for a real payday yet. Timesheets on production were only checked with logged-out requests: the routes answer and the new script loads. The full flow was tested on local data only.

**Next:**
1. Hear back from Sam on the Sep 16–30 payday and fix anything that comes up.
2. Thanksgiving hand check around Oct 12–15.
3. Start Phase 2.

**State:** everything is committed, pushed and deployed. Untracked: `design/` (waiting on Sam), plus `HANDOFF.md` edits and the new `docs/payroll-plan.md` from this wrapup, not committed yet. Local D1 only: seeded Aug–Sep 2026 test punches and session rows `local-ts-test-session` (Sam) and `local-ts-staff-session` (Test Staff). Migration 0047 was edited after it was first applied locally, so local D1 got the `outcome` column and the responses table by hand. Production got the final version.

**Closed:** Try Phase 1 and decide on commit + deploy (done), 35 unpushed commits on master (done: pushed, they predated the last deploy), uncommitted .gitignore / CLAUDE.md edit from an earlier session (done: committed with d7bf928)
