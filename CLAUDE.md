# Panda Portal

Internal staff portal for Panda Hobby. Cloudflare Worker + D1, serving a vanilla-JS
front end from `public/`. No framework, no build step — what's in `public/` is what
the browser runs.

Live at **https://portal.pandahobby.ca**.

## Commands

```bash
npm run dev            # local server; uses the local D1 copy, not production data
npm test               # vitest, 39 tests
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
  routes/               session, dashboard, knowledge, clock, admin, conventions
public/
  core.js               shared helpers — MUST load first (esc, api, themes, battery)
  admin.js              Users & Roles
  conventions.js        Conventions
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
replaced by the four-item bottom nav (Home / Clock / Events / Docs).

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
bar and booth roster. **The boss gets no clock card** — hall hours gain coverage
metrics and the roster shows live status instead.

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
