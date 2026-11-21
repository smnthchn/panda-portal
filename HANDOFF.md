# Handoff: Panda Portal

## Working now
- 11-20_panda-portal (since 2026-11-20, main: docs/bonus-plan.md): planning the in-store sales bonus goal (POS Markham sales shown on the portal), and building it (Sam's go 2026-11-20). Staff are written by staff ID, never by name, in the plan, these notes and the migration (Sam, 2026-11-20). Live: the sales bonus is deployed to portal.pandahobby.ca (2026-11-20, commit fe6793c, pushed by Sam herself after the app's safety check blocked Claude's push twice; Deploy run 44867496903 passed). Migration 0049 ran on production: 3 new tables, 12 goals (7 with a goal set), Staff 5 on the weekday list and Staff 4 and 6 on the weekend list. Live too: the follow-up where the boss sees the staff cards on Home with a button through to Sales bonus (commit a10c04e, pushed by Sam 2026-11-20, Deploy run 44868429877 passed). Committed 2026-11-21 with Sam's OK and waiting for her push (not live until then): Sam's new card wording, space above and below the tree, and staff being shown only their own amounts. Sam reported she could not find the page on the live portal (2026-11-20); the live files do have the menu item, so a page refresh is the likely fix, not confirmed. Files: docs/bonus-plan.md (new), CLAUDE.md, shopify-app/shopify.app.toml (scopes), migrations/0049_sales_bonus.sql, src/lib/shopify.js, src/routes/bonus.js, src/index.js, public/bonus.js, public/bonus-tree.webp (Sam's own picture, made in ChatGPT), public/app.js, public/core.js, public/index.html, public/style.css, test/index.spec.js, design/DESIGN-STATUS.md, HANDOFF.md. Closed: sales access test (passed 2026-11-20, read only)

## Open items
- [Claude] Build Phase 2 (positions, dated rates, position picker on shifts, pay timeline, read-only view for staff) as planned in `docs/payroll-plan.md` (added 2026-09-28; no longer waits on a payday, the app isn't in real use yet)
- [Claude] FAQ cutover step 20, ask Sam first (deletes on the live store): delete theme copy 189206954290, the empty `/pages/avada-faqs` page, and the 2021 body text on `/pages/faq` (added 2026-11-03)
- [Sam] Decide: fix the 3 stale FAQ answers on the live page (two mention Covid or the pandemic, one links to pandahobby.store; the Markham answer needs checking). Edit them in Shopify admin, or say what they should say. Marked UNDECIDED in `docs/faq-plan.md` (added 2026-11-09)
- [Claude] FAQ phase 3: the portal FAQ editor (plan in `docs/faq-plan.md`, clickable mockup `design/mockups/faq-editor.html`) (added 2026-11-03)
- [Sam] Decide, in December after the Black Friday sale ends (Nov 30): plan moving the competitor data into the portal as a database (idea from the panda-knowledge session, 2026-11-17). Not decided, nothing built, not in any plan. Today it lives outside the portal: the Competitor Analysis page (https://claude.ai/artifact/CCvhTf4EyaFiMLvHg8jewk) and, in `C:\dev\panda-knowledge\analysis\`, `competitors.md` (how it is checked), `competitor-black-friday-history.md` (what each store did and when) and `competitor-price-history.csv` (every week's prices, about 6,800 rows a year, the part that would earn a database). Why wait: the data is small and its shape was still changing in November (added 2026-11-17)
- [Claude] Only if the sales bonus ever runs all year (it is Nov and Dec 2026 only, Sam 2026-11-20): leave out convention days rung up under the Markham POS location (Fan Expo 2026, Aug 27 to 30, $56,302), from both the weekly sales and the past-year averages. Also needs a rule for a matching week when the store was closed ($0 weeks in May 2024, Aug 2024, May 2025, May 2026), or the goal comes out at half. Details in `docs/bonus-plan.md` What we know (added 2026-11-20)
- [Sam] Decide, after seeing how the first weekend goes ($6,000 for Nov 21 to 22, Sam's try, 2026-11-20): the goals for the five weekends after it. Last year minus 10%, as is, or plus 10%. Sam wants a goal reachable before the day ends, so the steps reward pushing through the extra hours. Against that: the plan's rule is a goal at or a little above where sales would land, and minus 10% would have been hit on 7 of the last 8 weekends with no change in sales (as is 5 of 8, plus 10% 4 of 8), paying about $145 a weekend. Next one, Nov 28 to 29: $5,850, $6,500 or $7,150. Marked UNDECIDED in `docs/bonus-plan.md` (added 2026-11-20)
- [Sam] Decide: do the sales bonus goals for Dec 1 to 19 need lowering? Last year's sale ran Nov 7 to Dec 19, 2025 and this year's runs Nov 20 to 30, so those goals are built on sale days (is there a December sale this year?). The low November weekdays (55% to 61% of last year, Nov 2 to 20) were mostly this sale timing. Marked UNDECIDED in `docs/bonus-plan.md` (added 2026-11-20)
- [Sam] Decide: sales bonus goals weekly (in the plan, and what is built) or daily. She "keeps thinking about daily again" (2026-11-20), not decided. What was measured: a goal built on one day last year swings a lot (Staff 5's daily goals would run from $210 to $3,270 at minus 10%), and daily pays for single good days in a poor week (Oct 19 to Nov 20, 2026: 10 of 25 weekdays hit, against 1 of 5 weeks). Claude's Proposal for the daily feel without changing the pay rule: one row of lights per day on the card. Switching to daily goals means new goals for all 40 days, a new pay rule and a rebuild of the goal rows. Marked UNDECIDED in `docs/bonus-plan.md` (added 2026-11-20)
- [Claude] Sales bonus, idea Sam loves for later (2026-11-20, not to build now): if a week ever needs more than the tree's 22 lights ($2,200 past the goal), add gifts under the tree, one for each further step. Looks she passed over, in case they come up again: thermometer, panda on bamboo, paint jar, stocking, string of lights in rows (added 2026-11-20)
- [Claude] Sales bonus tree, small things: the tree sits left of centre in its panel (the dollar marks take the left side); the lights past the goal have no "+$25" marker at every fifth light; 22 lights cover $2,200 past the goal and nothing shows beyond that; not checked in the dark theme (added 2026-11-20)
- [Sam] Confirm: the $25 per $500 step applies to the weekend too, split in two. Marked UNDECIDED in `docs/bonus-plan.md` (added 2026-11-20)
- [Sam] Confirm (asked 1x, 2026-11-21): is "staff are only ever told their own amount, never a total that gets split" a non-negotiable for the sales bonus, and should Claude remember it for every project? It is already in the plan as decided and built (added 2026-11-21)
- [Sam] Confirm two things about who shares a sales bonus (asked 1x, 2026-11-20). One: the split Claude built, where each day's share goes to whoever worked that day (weekend $120: both work both days $60 each; one works alone $120; one both days and the other Sunday only $90 and $30; a day nobody on the goal worked is not paid, so Staff 5 missing a day gets $80). Two: is "only people who worked that day share the bonus" a non-negotiable? (added 2026-11-20)
- [Claude] Sales bonus, later: once the clock and schedule are in real use, who worked can come from them instead of the boss's tick boxes (Sam, 2026-11-20: the ticks stand in "for now"). Not possible today: someone covering a day who isn't on the goal's list can't be given a share (added 2026-11-20)
- [Claude] Sales bonus went live 2026-11-20. Still to check on the live portal, because it needs a signed-in person and a real sale: the boss's Sales bonus page loads (ask Sam or Baldwin to open it once); the first read of sales from Shopify on production works (after the store opens Nov 21, `bonus_blocks.sales_checked_at` should be set for the Nov 21 weekend); and how long a new sale takes to show on the card (the plan says at most two minutes, not yet timed) (added 2026-11-20)
- [Claude] Sales bonus, not checked yet: the boss page on a phone, the card in the other four themes and a custom theme, and the meter once sales pass three steps (added 2026-11-20)
- [Claude] Local test data only (local D1, not production): two extra goals for Nov 14 to 15 and Nov 16 to 20, local staff 3 and 4 on the lists, two test unticks (local staff 3 off Sat Nov 14 and Wed Nov 18), the `bonus_absences` table made by hand (0049 was edited after it was first applied locally), and the two `local-ts-*` sessions renewed to 2026-11-27 (added 2026-11-20)
- [Claude] After each sales bonus goal ends, check the portal's figure against Shopify's own report and tell Sam who earned what. First one: the weekend of Nov 21 to 22, goal $6,000, pays $120, shared by who worked each day (added 2026-11-20)

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
