# Panda Portal

Internal staff portal for Panda Hobby. Cloudflare Worker + D1, serving a vanilla-JS
front end from `public/`. No framework, no build step — what's in `public/` is what
the browser runs.

Live at **https://portal.pandahobby.ca**.

## Commands

```bash
npm run dev            # local server; uses the local D1 copy, not production data
npm test               # vitest, 72 tests
npm run migrate:local  # apply migrations to the local D1
npm run migrate:remote # apply migrations to production
npm run migrate:check  # list pending remote migrations — the source of truth
npm run deploy         # wrangler deploy
```

### Deploying — read this before chaining commands

`migrate:remote` can print a `7403` API error **after the migrations have actually
applied**. It's a wrangler bug, not an auth or account problem. Because it exits
non-zero, `npm run migrate:remote && npm run deploy` will silently skip the deploy
and leave production running old code against a new schema.

Deploy in three steps instead:

1. `npm run migrate:remote` — may print a spurious error
2. `npm run migrate:check` — "No migrations to apply!" means step 1 worked
3. `npm run deploy`

## Layout

```
src/
  index.js              route table: [method, path, handler]; :params supported
  lib/
    auth.js             Google token verification (JWKS), sessions, requireUser
    permissions.js      roles, permission keys, effective-permission resolution
    google.js           service-account JWT, Drive listing, Google Doc -> HTML
    http.js             json(), matchPath(), cookies, field validation
  routes/               session, dashboard, knowledge, clock, admin, staff,
                        conventions, schedule
public/
  core.js               shared helpers — MUST load first (esc, api, themes, battery)
  admin.js              Users & Roles
  staff.js              Staff — details, folders, shift assignment
  conventions.js        Conventions
  schedule.js           Schedule builder
  app.js                shell, login, dashboard, KB, My Folder, Clock, Appearance
migrations/             numbered SQL, applied via wrangler
```

Script order in `index.html` matters: `core.js` defines the helpers, `app.js` calls
`loadApp()` at the end.

## Design language

Phone-first retro UI, from the Claude Design handoff (`design_handoff_panda_portal/`,
kept outside the repo). The rules that make it cohere:

- **2px solid ink outlines** on every card, never a 1px hairline.
- **Chunky radii**: cards 16px, inner blocks 14px, buttons 12px, pills 999px.
- **Hard offset shadows, no blur**: `0 4px 0 var(--shadow)`.
- **Buttons depress on hover** — `border-bottom-width` 4px → 2px plus `margin-top: 2px`.
  Green and amber buttons outline in a deeper shade of their own fill, never ink.
- **Section headers are tinted strips** across the top of a card (`.card.stripped`
  + `.strip`), not floating headings.
- Fredoka for numbers/labels/buttons, Public Sans for body copy.

**Every colour comes from a CSS custom property**, never a literal — five palettes
ship (`habbo`, `mario`, `bubble`, `sherbet`, `arcade`) and staff pick one in
Appearance. It's stored in `employees.theme_id`, so it follows a person to the
shared iPad. `arcade` is dark: pills over a coloured band use `.pill-paper`
(paper fill, ink border), and inputs read `--field`, which is dark there.

The desktop sidebar is kept for the boss's longer screens; below 800px it's
replaced by the four-item bottom nav (Home / Clock / Events / More). **More is
load-bearing, not a nicety** — the sidebar is hidden on a phone, so it's the
only way to reach Staff, Docs, My Folder, Users & Roles and Appearance there.
Anything added to the sidebar and not to `BOTTOM_NAV` shows up in More
automatically.

Screens that are a phone screen stay in a 560px column on desktop. Data-dense
ones opt into the full width by passing `markActiveNav(view, { wide: true })` —
Timesheets and Users & Roles do. Every render calls `markActiveNav`, so the
width can't leak from the previous screen. Widening buys more rows on screen
(timesheets go side by side, the permission table stops scrolling), never
longer lines of prose.

## Dashboard

`/api/dashboard` answers the whole home screen in one request, and decides the
day server-side so the screen can't disagree with the schedule. The browser
passes its own local date (`?today=`) because the worker runs UTC and the store
is in Toronto.

A staff member sees the fixed spine (date + identity, clock card, shift), then a
block set chosen by the day: store day gets the roster and the upcoming-event
nudge; a convention day swaps in the amber event band, break battery, hall-hours
bar and booth roster. **The boss gets no clock card and no personal shift card**
— hall hours gain coverage metrics, and *Who's on today* is their main view.

`buildRoster()` answers "who's scheduled today and when" on any day, not just a
convention day. It takes every shift dated today across all events (a tear-down
shift falls outside its show's run) **plus anyone who clocked in without a
shift** — on a store day that's the whole team, since shifts only exist against
conventions. Each row carries a status decided server-side so the badge and the
punch log can't disagree: `in`, `break`, `done`, `upcoming`, `late` when a
shift started more than 15 minutes ago and nobody clocked in, and `missed`
(NO SHOW) once such a shift has finished — someone who never came is a
different conversation from someone running late. Live
status is read off the **last punch**, not the cached `clock_profiles` status,
so someone with punches but no profile row still shows a real state.

## Break battery

The allotment is set on the shift by the boss (`break_allotment_minutes`,
`break_count` on `convention_shifts`) — nothing is derived from shift length.
`batteryHtml()` in `core.js` draws six cells that **empty left to right**, so
the charge that's left sits against the terminal nub; a two-break allotment gets
a divider marking the split. Cells are a proportion of the allotment rather than
a fixed ten minutes each — identical to the handoff's `ceil(left / 10)` on its
60-minute example, but a 30-minute allotment still shows a full battery when
nothing's been used. Minutes used come from the punch log, so the battery and
the hours report can't disagree.

## Auth & permissions

Google Sign-In only, against an allowlist in the `employees` table. Tokens are
verified properly — RS256 signature against Google's JWKS, plus issuer, audience,
and expiry. Sessions expire server-side; `expires_at` is written and compared with
SQLite `datetime()`, **not** ISO strings (they don't compare correctly).

Roles: `boss`, `staff`, `volunteer`. Access is a role default plus optional
per-person overrides:

- `role_permissions` — the default for each (role, permission) pair
- `employee_permission_overrides` — sparse; a row only where someone deviates

Effective = override if present, else role default. Both are edited from the
**Users & Roles** page. Guard rails prevent removing the last active Boss or
stripping your own admin access.

## Conventions

Event details, per-day hours, shifts and checklists live in D1. Long documents stay
in Drive, linked per convention.

Two different setup concepts, deliberately kept separate:

- `setup_on` + `load_in_start/end` on the convention — the move-in day before doors
- per-day `setup_start` in `convention_days` — when to be at the booth each day

Per-day setup and early access are start-only: early access runs until doors
open, so the form derives early (doors − 1h) and setup (an hour before that)
from the regular start, editable. The `setup_end` and `early_end` columns are
dead — the save handler always writes NULL there.

Checklists are audience-gated (`all` / `staff` / `boss`) and anyone who can see one
can tick its items; the tick records who and when.

Two separate map links, because they're two different places: `map_url` is the
venue (falls back to a Maps search of the address) and `parking_map_url` is
where to actually park — the loading dock or staff lot is rarely the building's
front door. Both surface as rows in **Getting there**, the last card in the
scroll.

## Convention presets

`OUR_CONVENTIONS` in `public/conventions.js` lists the shows Panda Hobby actually
does — Anime North and Fan Expo Canada — with the venue details that never change
and each show's typical hall hours keyed by weekday. The New Convention form's
preset buttons fill the stable fields instantly, and the hours editor lays the
typical hours onto the event's dates, offering each unsaved day as a "Load into
form" suggestion. It's plain data rendered on every draw, so saving a day can't
wipe the remaining suggestions. Add a row for a new show; verify hours against the
official site once the year's page is up.

This replaced an AI web-search lookup (removed Aug 2026). The lookup took ~20s per
run, its results were lost on every save, and it mostly rediscovered hours that
don't change year to year. Setup and load-in times still aren't public either way —
they live in the exhibitor kit, so the boss fills those in by hand.

## Scheduling

**A shift doesn't have to belong to an event.** `convention_shifts.convention_id`
is nullable — NULL means an ordinary store shift. Migration 0012 rebuilt the
table to drop the NOT NULL (SQLite can't do it in place). This is deliberately
one shift model rather than two: the roster, the clock, the staff page and the
dashboard all keep working without knowing which kind they're looking at.
**Any query joining conventions must LEFT JOIN**, or store shifts vanish.

Two screens over that one model:

- **Schedule** (`/schedule`) — the store week. Seven day tabs, week arrows,
  and the store's usual hours (`store_hours`, one row per weekday, 0 = Sunday)
  which drive the coverage check. Convention shifts that fall in the week are
  shown read-only, since they belong to the event.
- **Event schedule** (`/conventions/:slug/schedule`) — reached from **Build**
  on the event's Full schedule card. Its day tabs cover the event's run plus its setup
day plus any date that already has shifts; a day nobody is on is amber, because
that's the one that needs you. Opening it lands on the first day with gaps,
unassigned shifts, or nobody on it.

**Coverage is the point of the screen.** `coverageGaps()` in `routes/schedule.js`
merges the day's shifts into stretches and reports the holes *inside hall
opening hours* — including a late start and an early finish, which are the two
that actually bite. A setup shift that ends before doors open contributes
nothing, deliberately. No hall hours for a day means no claim is made rather
than a false NO GAPS.

Shifts are tapped to edit in place, and **Copy this day** duplicates everyone
(times and break allotments included) onto an empty day — it refuses a target
that already has shifts rather than silently doubling them.

There's no per-day publish state: `conventions.is_published` already gates
whether staff see the event at all, which is the real switch for a team this
size.

## Availability & time off

Two things, deliberately separate: **availability** is the recurring weekly
pattern ("can't do Mondays", "not before 5 on Thursdays"), **time off** is a
specific stretch of dates that gets requested and answered.

Everyone manages their own on **My availability**; a boss edits anyone's from
their Staff page and approves or declines requests there. A boss requesting
their own time off has it approved on the spot — there's nobody above them to
ask.

`employee_availability` holds only the days someone has spoken about;
`fullWeek()` fills the rest in as available with no limits, so an empty table
means "everyone, any time" rather than "nobody, ever".

**The point is that the scheduler reads it.** `availabilityConflict()` is
called per person per day by both builders: the picker labels people
("Kevin — not available Mondays", "— on approved time off") and a saved shift
keeps the warning on its card. It **flags, never blocks** — a boss may well
have asked someone to come in on a day they'd normally not. Approved time off
outranks the weekly pattern; a pending request is reported in weaker words.

## Staff vs Users & Roles

Deliberately two screens over the same `employees` table:

- **Staff** (`routes/staff.js`, `public/staff.js`) — the person. Name, the
  Google account they sign in with, phone, location, start date, notes, their
  Drive folder, and their shifts. Boss-only.
- **Users & Roles** (`routes/admin.js`) — the login. Adding a person, roles,
  active/inactive, and permission overrides. The guard rails around the last
  active Boss live here.

Editing a person's email changes the account they sign in with, so it's
validated and kept unique the same way creating one is.

### Avatars

Each person can have their own illustration. The browser shrinks the picked
file to a 256px square (centre-cropped, WebP where supported so transparency
survives) **before** upload, so what reaches D1 is a few KB — a column beats
standing up R2 for a team this size.

It's served from `GET /api/avatar/:id` behind a login, with a long
`Cache-Control` and a `?v=` stamped from `updated_at`, so JSON payloads carry
a URL rather than every face on the team inlined. `parseAvatarDataUri()`
refuses anything that isn't base64 PNG/JPEG/WebP — **SVG especially**, since
the string lands in an `<img src>` and an SVG there is script execution.

`avatarHtml()` keeps the initials in the markup underneath the picture, so a
picture that fails to load degrades to initials rather than a broken image.

`employees.google_drive_folder_id` is the folder behind that person's **My
Folder** page (`/api/my-folder` lists it via the service account). Setting the
ID here doesn't grant access — the folder still has to be shared with their
Google account in Drive.

Shifts can be assigned from either side: the event's own page, or a person's
Staff page picking from unassigned shifts across every upcoming event. Both go
through `PUT /api/convention-shifts/:id/assign`, which refuses a shift that
overlaps one the person is already on that day.

## Clock

Punches in `clock_events` are the source of truth; `pairClockEvents()` in
`routes/clock.js` walks them into shifts — breaks deducted, a forgotten clock-out
flagged and never counted toward a total. Timestamps are UTC (SQLite
`CURRENT_TIMESTAMP`), so grouping into days and weeks happens in the browser in
local time — don't group by date in SQL, or evening shifts land on the next day.

**The boss doesn't punch a clock, they read everyone else's.** `/clock` renders
as **Timesheets** for anyone with `manage_users` — the team report, no clock
buttons — and their own hours appear only if they turn out to have punches. The
nav calls it Hours/Timesheets for them, Clock for everyone else. The dashboard
likewise gives the boss the floor instead of a clock card.

A boss fixes a wrong or missing clock-out from Team hours; the correction is a
normal `clock_events` row stamped with who fixed it. That inserted row has a
late id, which is why `pairClockEvents()` orders by `created_at`, never by id.
Closing someone's trailing open shift also resets their live status, or their
next Clock In would be rejected. Forgotten clock-outs usually surface as a
~24-hour shift (people clock out the next morning when the portal tells them
they're still in), so 16h+ shifts are flagged "check this" in the report.

## Secrets

Set with `wrangler secret put NAME` for production, and in `.dev.vars` for local:

- `GOOGLE_CLIENT_ID` — OAuth client for Sign-In
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — Drive access

`.dev.vars` is gitignored. Don't commit it.

## Gotchas

- **Style inputs by exclusion.** `input:not([type="checkbox"]):not([type="radio"])`,
  not a list of types — a listed-types rule silently skips any new input type.
- **`openConvention(slug, pushState)`** only resets the manage panel when `pushState`
  is true, so saving something doesn't collapse the editor you're working in.
- **Every management form has a jump button** on the card that displays its data.
  The forms sit at the bottom of the page; without the buttons they're unfindable.
- **The `can_*` columns on `employees` are dead.** Superseded by the permission
  tables in migration 0002; nothing reads them.
- **Local dev uses a separate D1 database.** Data differs from production, and Google
  Sign-In needs `http://localhost:8787` as an authorized origin to work locally.
