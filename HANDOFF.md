# Handoff: Panda Portal

## Working now
<!-- One line per session changing this project right now (global "Claim before changing"). -->

## Open items
- [Claude] Build Phase 2 (positions, dated rates, position picker on shifts, pay timeline, read-only view for staff) as planned in `docs/payroll-plan.md` (added 2026-09-28; no longer waits on a payday, the app isn't in real use yet; asked 1x on 2026-11-20 whether it is still needed)
- [Claude] FAQ cutover step 20, ask Sam first (deletes on the live store): delete theme copy 189206954290, the empty `/pages/avada-faqs` page, and the 2021 body text on `/pages/faq` (added 2026-11-03)
- [Sam] Decide: fix the 3 stale FAQ answers on the live page (two mention Covid or the pandemic, one links to pandahobby.store; the Markham answer needs checking). Edit them in Shopify admin, or say what they should say. Marked UNDECIDED in `docs/faq-plan.md` (added 2026-11-09, asked 1x)
- [Claude] FAQ phase 3: the portal FAQ editor (plan in `docs/faq-plan.md`, clickable mockup `design/mockups/faq-editor.html`) (added 2026-11-03)
- [Sam] Decide, in December after the Black Friday sale ends (Nov 30): plan moving the competitor data into the portal as a database (idea from the panda-knowledge session, 2026-11-17). Not decided, nothing built, not in any plan. Today it lives outside the portal: the Competitor Analysis page (https://claude.ai/artifact/CCvhTf4EyaFiMLvHg8jewk) and, in `C:\dev\panda-knowledge\analysis\`, `competitors.md` (how it is checked), `competitor-black-friday-history.md` (what each store did and when) and `competitor-price-history.csv` (every week's prices, about 6,800 rows a year, the part that would earn a database). Why wait: the data is small and its shape was still changing in November (added 2026-11-17)
- [Sam] Decide: do the sales bonus goals for Dec 1 to 19 need lowering? Last year's sale ran Nov 7 to Dec 19, 2025 and this year's runs Nov 20 to 30, so those goals are built on sale days (is there a December sale this year?). The low November weekdays (55% to 61% of last year, Nov 2 to 20) were mostly this sale timing. Marked UNDECIDED in `docs/bonus-plan.md` (added 2026-11-20)
- [Claude] Sales bonus tree, small things: the tree sits left of centre in its panel (the dollar marks take the left side); the lights past the goal have no "+$25" marker at every second light; 22 lights cover $5,500 past the goal and nothing shows beyond that; not checked in the dark theme (added 2026-11-20)
- [Sam] Confirm (asked 1x, 2026-11-21): is "staff are only ever told their own amount, never a total that gets split" a non-negotiable for the sales bonus, and should Claude remember it for every project? It is already in the plan as decided and built (added 2026-11-21)
- [Claude] Sales bonus: time how long a new sale takes to show on the staff card (the plan says at most two minutes) (added 2026-11-20)
- [Claude] Sales bonus, not checked yet: the boss page on a phone, the card in the other four themes and a custom theme, and the meter once sales pass three steps (added 2026-11-20)
- [Claude] Local test data only (local D1, not production): two extra goals for Nov 14 to 15 and Nov 16 to 20, local staff 3 and 4 on the lists, two test unticks (local staff 3 off Sat Nov 14 and Wed Nov 18), a test added day, the `bonus_extra_days` table and `day_rate_cents` column made by hand, the `bonus_absences` table made by hand (0049 was edited after it was first applied locally), and the two `local-ts-*` sessions renewed to 2026-11-27 (added 2026-11-20)
- [Claude] After each sales bonus goal ends, check the portal's figure against Shopify's own report and tell Sam who earned what. Done for the weekend of Nov 21 to 22: goal $5,900, sales $8,317, goal met with 4 steps, $180 in total, $90 for each of the two weekend staff (both ticked both days). Next: the week of Nov 23 to 27. From 2026-11-24 the result is told to Sam in the conversation and only "checked, matched or not" is written here, with no sales figures (added 2026-11-20)
- [Sam] Decide: take the sales figures written before 2026-11-24 out of today's files (the What we know part of `docs/bonus-plan.md`, a few lines in these notes) and keep them in `local-notes/` on this computer? Claude's Proposal, 2026-11-24. They would still be in the repo's history and in migration 0049, which has already run and cannot be edited (added 2026-11-24)
- [Sam] Decide: hide the next sales bonus goal from staff until its first day? Today a card shows the very next goal the moment the current one ends, so a goal can only be changed unseen up to then. Claude's Proposal (2026-11-21): hide it, so a goal can be adjusted right up to the morning it starts. Marked UNDECIDED in `docs/bonus-plan.md` (added 2026-11-24)

## Backlog
<!-- Plan phases and later ideas. Not triaged at /startup; pulled into Open items when it's time. -->
- [Claude] Only if the sales bonus ever runs all year (it is Nov and Dec 2026 only, Sam 2026-11-20): leave out convention days rung up under the Markham POS location (Fan Expo 2026, Aug 27 to 30), from both the weekly sales and the past-year averages. Also needs a rule for a matching week when the store was closed (weeks in May 2024, Aug 2024, May 2025, May 2026), or the goal comes out at half. Details in `docs/bonus-plan.md` What we know (added 2026-11-20)
- [Claude] Sales bonus, idea Sam loves for later (2026-11-20, not to build now): if a week ever needs more than the tree's 22 lights, add gifts under the tree, one for each further step. Looks she passed over, in case they come up again: thermometer, panda on bamboo, paint jar, stocking, string of lights in rows (added 2026-11-20)
- [Claude] Sales bonus, later: once the clock and schedule are in real use, who worked can come from them instead of the boss's tick boxes (Sam, 2026-11-20: the ticks stand in "for now") (added 2026-11-20)

## Parked
<!-- Items asked about twice at /startup with no answer. Not lost, just not nagging. -->
- [Claude] FAQ sticky header: on desktop the theme's 138px sticky header covers the question title when a `#hc-…` link opens it, because `faq.css` only leaves `scroll-margin-top: 24px` (lines 120 and 132). Fix the CSS, then release a new app version. Sam (2026-11-03): leave it for now. Good time to do it is the next app release, e.g. phase 3 (added 2026-11-03, parked 2026-11-03 by Sam)

---

## 2026-11-24 (11-20_panda-portal: in-store holiday sales bonus)
**Done:**
- Planned with Sam, then built, the in-store holiday sales bonus (Markham POS sales, Nov 21 to Dec 31, 2026): a goal for each week and each weekend, a boss-only Sales bonus page (each goal beside its 2025 sales, pay, who worked), and a card on each staff member's Home with a Christmas tree that fills as sales come in, made from Sam's own picture. Sales are read from Shopify by the portal's own app, with refunds and cancellations taken off.
- Live on portal.pandahobby.ca: six pushes, all Deploy runs passed (fe6793c, a10c04e, fd26719, c119597 pushed by Sam; 74830d1 and 3e97f9d pushed by Claude). Migrations 0049 and 0050 ran on production. Production data: all 12 goals set to last year minus 5% (2026-11-21). Sam added `read_orders` and `read_all_orders` to the live Panda Portal Shopify app herself. Claude only read from Shopify.
- Changed after go-live, on Sam's word: staff see only their own amounts; a finished goal shows staff only their bonus; pay is $20 per person per day worked, with the steps past the goal shared by days worked; anyone can be added to a single day; one tree light is $250.
- Checked against Shopify's own report (2026-11-24): the first weekend, Nov 21 to 22, met its goal and the portal's figure was within $2 of the report; Mon Nov 23 matched to the cent.
- Rules Sam set: staff are written by staff ID, never by name (2026-11-20); sales figures stay out of this repo from now on, a strong suggestion (2026-11-24). Three notes on how to answer her were saved to Claude's memory for every session (2026-11-21); the memory folder has no git.
- Plan: `docs/bonus-plan.md` is new and holds every bonus decision (Sam). CLAUDE.md got a Sales bonus section, the bonus plan on its `Plan:` line, and the sales figures rule (Sam, 2026-11-24).

**Left off:** The bonus is running live. The week of Nov 23 to 27 is in progress and ends Fri Nov 27. Three decisions wait on Sam (Dec 1 to 19 goals, the older figures, hiding the next goal).

**Next:**
1. After Fri Nov 27: check that week against Shopify's own report and tell Sam the result in the conversation.
2. Sam's decision on the Dec 1 to 19 goals, before Mon Nov 30.
3. Time a new sale showing on the card; check the boss page on a phone and the card in the other themes.

**State:** clean: everything is committed, pushed and deployed. Local D1 only: the test data listed in the open items. The three new memory files are not backed up yet (`C:\dev\backup.ps1`, open item in `C:\dev\HANDOFF.md`).

**Closed:** Sales access test (done at startup: passed, read only). Sales bonus went live (done; leftover kept: time a new sale). How to talk to Sam about the bonus (done: saved as three memory notes). Moved to Backlog: convention days if it runs all year, gifts under the tree, who worked from the clock.

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
