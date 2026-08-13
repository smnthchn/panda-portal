# Panda Portal

Internal staff portal for Panda Hobby. Cloudflare Worker + D1, serving a vanilla-JS
front end from `public/`. No framework, no build step — what's in `public/` is what
the browser runs.

Live at **https://portal.pandahobby.ca**.

## Commands

```bash
npm run dev            # local server; uses the local D1 copy, not production data
npm test               # vitest, 35 tests
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
  routes/               session, knowledge, clock, admin, conventions
public/
  core.js               shared helpers — MUST load first (esc, api, formatting)
  admin.js              Users & Roles
  conventions.js        Conventions
  app.js                shell, login, KB, My Folder, Clock — boots the app, loads last
migrations/             numbered SQL, applied via wrangler
```

Script order in `index.html` matters: `core.js` defines the helpers, `app.js` calls
`loadApp()` at the end.

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
