# Handoff: Panda Portal

## Working now

## Open items
- [Claude] Build Phase 2 (positions, dated rates, position picker on shifts, pay timeline, read-only view for staff) as planned in `docs/payroll-plan.md` (added 2026-09-28; no longer waits on a payday, the app isn't in real use yet)
- [Claude] FAQ cutover step 20, ask Sam first (deletes on the live store): delete theme copy 189206954290, the empty `/pages/avada-faqs` page, and the 2021 body text on `/pages/faq` (added 2026-11-03)
- [Sam] Decide: fix the 3 stale FAQ answers on the live page (two mention Covid or the pandemic, one links to pandahobby.store; the Markham answer needs checking). Edit them in Shopify admin, or say what they should say. Marked UNDECIDED in `docs/faq-plan.md` (added 2026-11-09)
- [Claude] FAQ phase 3: the portal FAQ editor (plan in `docs/faq-plan.md`, clickable mockup `design/mockups/faq-editor.html`) (added 2026-11-03)

## Parked
<!-- Items asked about twice at /startup with no answer. Not lost, just not nagging. -->
- [Claude] FAQ sticky header: on desktop the theme's 138px sticky header covers the question title when a `#hc-…` link opens it, because `faq.css` only leaves `scroll-margin-top: 24px` (lines 120 and 132). Fix the CSS, then release a new app version. Sam (2026-11-03): leave it for now. Good time to do it is the next app release, e.g. phase 3 (added 2026-11-03, parked 2026-11-03 by Sam)

---

## 2026-11-09 (one-time plan sort, from the /startup wrapup fix session)
**Done:** CLAUDE.md got Where things live (Plan: CLAUDE.md, docs/faq-plan.md, docs/payroll-plan.md; docs/ai-foundation/ is reference only), a Bring list section (it was described as not built; it is), and the full routes list. Plan: the live FAQ moved into a CLAUDE.md FAQ section and faq-plan.md is trimmed to the unbuilt editor (Sam, 2026-11-09), all 15 decisions kept; the stale live FAQ answers are a Decide item.
**State:** committed, not pushed (pushing master redeploys the portal).

## 2026-11-03 (FAQ migration)
**Done:**
- The SB: FAQ HelpCenter app is gone. The yearly charge arrived before the Dec 22 renewal we expected, but the developer hadn't collected it and said Sam could uninstall at no charge. Sam uninstalled it 2026-11-03.
- Sam added the redirect `/apps/help-center` → `/pages/faq`, and Shopify accepted the `/apps/` path, so the app-proxy fallback isn't needed. Tested: it 301s with or without a trailing slash or query, and `#hc-…` question links still open the right question. The redirects page is now admin.shopify.com/store/panda-hobby-store/redirects (Navigation moved under Content → Menus).
- Earlier in this run of sessions: page live 2026-10-23, every link repointed 2026-10-26 (0 old links across 55 pages), and all 47 Shopify notification emails checked with 0 old links (2026-10-27).
**Left off:** The cutover is done apart from step 20 cleanup. The sticky-header issue was found and parked by Sam.
**Next:**
1. (done 6cb8d2d)
2. Step 20 cleanup, with Sam's OK.
3. Phase 3, the portal FAQ editor.
**State:** clean. The FAQ work (`shopify-app/`, `docs/faq-plan.md`, `design/mockups/`) was committed and pushed as 6cb8d2d with Sam's OK; the Deploy workflow passed (same Worker code). The FAQ app (faq-2) is released on Shopify; nothing is waiting to deploy.
**Closed:** Commit the FAQ work (done: 6cb8d2d). Also done outside the list: FAQ steps E and F (uninstall + redirect).

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
