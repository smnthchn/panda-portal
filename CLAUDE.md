# Panda Portal

Internal staff portal for Panda Hobby. Cloudflare Worker + D1, serving a vanilla-JS
front end from `public/`. No framework, no build step — what's in `public/` is what
the browser runs.

Live at **https://portal.pandahobby.ca**.

## Commands

```bash
npm run dev            # local server; uses the local D1 copy, not production data
npm test               # vitest, 96 tests
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

`migrate:check` can throw the same `7403` on its own, without applying anything
— it's a plain read, so a failure there says nothing about the schema. When it
does, ask the database directly instead:

```bash
npx wrangler d1 execute panda_portal_db --remote --json   --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 3"
```

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
                        conventions, schedule, shelves, resources
public/
  core.js               shared helpers — MUST load first (esc, api, themes, battery)
  admin.js              Users & Roles
  staff.js              Staff — details, folders, shift assignment
  conventions.js        Conventions
  resources.js          Resources — the store's image library
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
- **Buttons depress on hover**, and the depress must not move the page. The
  bottom edge is `--edge` at rest plus `--depress` of give; hovering takes
  `--depress` off the edge and adds it above, so the box never changes size.
  **Never set `border-bottom-width` on a button** — that used to be two
  hard-coded 2px values which only cancelled for a full 4px edge, so every
  smaller button grew by 2px on hover and twitched the whole page. A rule using
  the `border` shorthand resets the bottom edge behind the calc and so must
  declare what it changed: `--depress: 0px` for a flat button, `--edge: 0px;
  --depress: 0px` for a borderless one. Zeroes need units, or the `calc()` is
  invalid and the border silently falls back to `medium` (3px).
  Green and amber buttons outline in a deeper shade of their own fill, never ink.
- **Section headers are tinted strips** across the top of a card (`.card.stripped`
  + `.strip`), not floating headings.
- Fredoka for numbers/labels/buttons, Public Sans for body copy.
- **Times are picked from `timeSelect()` in `core.js`, not `<input type="time">`.**
  Shifts and opening hours are decided in quarter hours, and the native picker
  can't be told to list them: Chrome honours `step="900"` for the arrow keys
  (11:30 up is 11:45) but its dropdown still shows all sixty minutes, so
  scrolling it with a mouse whizzes straight past the :30 you were aiming for.
  A select lists exactly what we put in it, and matches the other controls on
  these forms. It reads back through `.value` like the input it replaced, so
  save handlers didn't change.
  **Assign into one with `setTimeSelect()`, never `.value =`** — a select
  silently ignores a value it has no option for, so an odd stored time would
  blank the field and the next save would write that blank back over it.
  `setTimeSelect()` gives the odd time an option first, in the right place in
  the order; `timeSelect()` does the same for a value it renders with.
  **The clock-out fix in `app.js` is deliberately excluded**: it stays a
  `datetime-local` on whole minutes, because somebody who forgot to clock out
  arrived at 11:47, not a quarter past anything.

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

Roles: `boss`, `staff`, `seasonal`, `volunteer`. **Seasonal Staff ranks level
with staff** in `ROLE_RANK` — it's the same job on a shorter contract, so
staff-only documents and checklists are theirs to read; the role exists to say
who's seasonal on a roster, not to fence them off. Equal ranks are fine there,
because nothing is ever gated on `seasonal` itself. Its permission defaults are
copied from staff's *current* rows by migration 0031 rather than typed out, so
they mirror whatever staff had grown into rather than reinstating the original
seed. Every (role, permission) pair must exist or a role resolves to no
permissions at all rather than to its defaults.

Access is a role default plus optional
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

## Booth Plan

The booth prep tool that replaced the spreadsheet, reached from the **Booth
Plan** pill at the top of an event. Called Booth Plan throughout the UI; the
code and tables still say `shelf` (`shelf_positions`, `/api/…/shelf-plan`),
which is the one naming seam in the project.

Three surfaces, chosen by who's looking and on what:

- **Grid** (desktop, boss) — every field edits in place, no edit mode, no modal.
- **List** (phone) — a card per unit with its five boxes spelled out. The grid
  is 900px of columns; dragging that sideways on a phone is not a tool. The two
  swap on a `matchMedia` breakpoint listener, so rotating a phone redraws.
- **Booth map** — its own page (`/conventions/:slug/booth-map`), not a tab
  inside the plan: it's the thing you send someone ("look at where C5 is"),
  and a refresh should come back to it. Reached from its own pill on the event
  page, and the header buttons move between the two pages so Back works.
  Drawn to scale at whatever fits its column. The design's
  31px per foot is 502px wide, which no phone can show and which can't be
  pinch-zoomed inside the app, so `measureScale()` divides the available width
  by the booth's 16 ft and caps at the design scale — never scaling up. A
  phone lands around 21px/ft with the whole booth visible.

A `ResizeObserver` on the page column redraws all three: the grid/list swap at
the breakpoint, and the map re-scales. It watches the column rather than the
window because the sidebar appearing changes the width without the window
resizing.

**Staff tick boxes and nothing else.** The server already enforces it —
everything except reading the plan and toggling a stage needs
`manage_conventions` — and the UI matches: for staff the editable cells render
as plain text and Arrange doesn't appear at all, rather than offering controls
the server would refuse.

**Adding a shelf asks which section it's in, and the shelf code opens the way
to change it.** Clicking a code in the grid opens a strip with its section and
a Remove. Both go through `sectionOrder()`, because the grid groups by *runs*
of the same wall rather than by wall: a shelf whose section changed but whose
place in the order didn't would open a second EAST WALL heading at the bottom
of the grid instead of joining the one already there. Changing the section
therefore renumbers the plan, putting the shelf after the last one already in
that section.

In Arrange, a selected unit moves with the **arrow keys** — 1″ a press, 6″ with
Shift — moving on screen at once with the save debounced, so holding a key
slides it rather than firing a write per press. Arrows are ignored while focus
is in a text field.

`lib/booth-template.js` holds the standard 31-unit Fan Expo booth — geometry in
feet, lifted from the design handoff's own tables rather than re-measured. A
plan starts from that template or **carries a previous show's plan forward**,
in which case last show's *arranged* positions become this show's baseline: you
start from where you ended up, not where you'd planned to be.

**Stage ticks are the hot path.** Several people tick boxes across the booth
during setup, so each tick is its own row in `shelf_stage_flags` and its own
small write — a read-modify-write of a whole record would lose other people's
ticks. The UI updates optimistically and only reloads if the write fails.

**BOARDS doesn't apply to a shelf needing no signage.** It drops out of both
the numerator and the denominator, so the count reads `7 / 20`, not `7 / 31`.
Adding signage to a shelf brings its Boards box to life and moves the
denominator; removing all of it clears any stale tick.

### Groupings

**A grouping is a product family — what actually goes on a shelf.** One rack
is HG Universal Century, one is Gundam SEED, one is Girls; the merchandising
photos are one family per rack, never mixed. The family belongs to the store
and outlives any show, so `groupings` sits store-wide beside Resources. What
changes per show is which shelf carries it and how deep each SKU is faced,
which is `shelf_groupings` — a row per (position, grouping), because a wide
unit can carry two families.

`facings` is the dial between shows: **3 or 4 at Anime North becomes 1 or 2 at
Fan Expo**, and the tail SKUs (Hexa Gear, MSG parts) drop out entirely. Anime
North is 800 sq ft against Fan Expo's 480, so something has to give.

A grouping carries `shopify_query` rather than a copied list of SKUs — the
catalogue's tags are structured enough to be the filter on their own
(`tag:'High Grade' AND tag:'Universal Century'`), so a new kit joins its family
the moment it's tagged. **Check a query returns something before trusting it**:
`tag:'Plush'` matches nothing, because the tag is `Plushies`.

`box_class` is how wide one box stands, which is what decides how many face
out across a 49.5″ tier. It's on the family because it's a property of the
product, not of the shelf it lands on.

### Tiers and capacity

**A grouping says what stands on a unit; the tiers say where, and capacity says
how many.** `shelf_grouping_tiers` is a row per (position, grouping, tier)
rather than a range, because a family skips tiers on purpose: small
easy-to-pocket stock is kept in the top three or four so nobody is bending over
an open bag. **Tier 1 is the top tier** — the numbering exists to serve that
rule, so it runs the way the shelf is looked at.

Tier heights are sparse, the way `employee_availability` is. A unit has a tier
count and a usable height (72″ by default), and `shelf_tiers` holds a row only
where a tier deviates from the even split — a blind-box unit is four short
tiers over two taller ones, so two rows describe it. Shelves are adjustable,
which is what SIZED means, so the tier count is a build decision rather than a
property of the model of shelf.

`lib/capacity.js` turns that into numbers. Families on a tier split its width
evenly and each shows as many SKUs as its faced boxes fit into that share, so
**raising facings lowers the SKU count** — that is the dial between shows.
Over capacity means a family can't show even one SKU, either because its share
is too narrow or its box is taller than the tier; it draws amber and says
which, and **nothing is ever blocked**, the same way `layoutConflicts()`
reports an overlap rather than refusing the move. Capacity is computed
server-side in `loadPlan()` for the same reason the roster decides its own
statuses: the grid, the phone and the map all draw it.

**A family's `sku_count` is the pool it is picked from, never a target.** The
catalogue runs about ten times the booth — ~4,700 in-stock SKUs across the
families against roughly 250 box widths on the floor — so a bar comparing tier
space against the catalogue would paint every shelf red. The honest reading is
"shows 8 of 79 in stock". The count is a hand-refreshed snapshot with the date
it was taken beside it; the worker has no Shopify access.

**Not everything lives on a tier.** `groupings.placement` is `tier`, `side`
(tools, TCG, action bases — zip-tied to the side of a unit) or `up_top` (the
big expensive boxes that sit on top of the shelves; there are only ever one or
two of each, and in a tier they would eat a whole run). Those show their
placement instead of an empty tier row, and what they need is a bring quantity
rather than a position — which isn't built yet.

**The phone shelf detail is a state, not a route.** The booth map earned its
own URL because it is the thing you send someone; a shelf's tiers are a
drill-down you come back out of, so Back steps out of the unit before it leaves
the plan. `box_class` and `box_height_in` were inert before capacity existed
and are now load-bearing — check them before trusting a tier that looks wrong.

### Resources, board artwork and shelf photos

Two different pictures, deliberately kept apart:

- **Board artwork** is a physical printed sign the store owns and hangs again
  next show, so it belongs to the store, not to one event. It lives in
  **Resources** (`resources`), reached from a button beside New convention on
  Events. Upload once, assign to a shelf on any event's booth plan.
- **Shelf photos** (`shelf_photos`) are how *this* shelf was merchandised for
  *this* show — shot at the store before it was packed, opened at the venue to
  rebuild from. They hang off the position, which is already per-event, and
  are never reused.

An earlier version (migration 0016, `board_artwork`) paired artwork to a board
by matching its **name** against the plan's Board name cell. It shipped and was
replaced the next day: pairing by name meant a typo silently lost the artwork,
and there was nowhere to put a picture that isn't a board. Assignment is now
explicit — `shelf_board_art` is one row per (position, face) pointing at a
resource.

**Artwork is chosen in the grid's Boards column, not on the map.** Clicking the
cell opens a strip under the row — the same shape as the signage editor — with
a slot per face and the library behind each one. That way a run down the column
sets the whole booth's signage in one pass, where the map would mean selecting
31 units one at a time. Only one strip is open at a time, or two of them under
one row would shove the grid around while you were reading it. The map panel
shows what's assigned and nothing more.

**A board is whatever is assigned to the face, called whatever the library
calls it.** `boardFaces()` reads assignments only. There's no second name kept
on the plan, so a board can't be called one thing on the grid and another on
the picture of it, and renaming it once in Resources renames it everywhere it
hangs. `shelf_positions.board_name` is left over from before this and is no
longer read — like the `can_*` columns, it's dead.

The cell shows names as plain text, dotted-underlined; the artwork is a hover
away in a preview positioned in fixed coordinates, because the grid scrolls
inside a clipping box that would cut a popover off at the card's edge. Empty
cells — signage and boards alike — offer a plain `+` rather than a dashed
outline shouting about a cell that is usually correctly empty.

Deleting a resource takes it off every shelf across every event, so the
confirmation says how many.

`loadResources()` and the plan's artwork query **never select the image
column** — pictures come from `/api/resource-image/:id` and
`/api/shelf-photo/:id` behind a login with a `?v=` stamped from `updated_at`,
so a plan naming twenty boards doesn't carry twenty pictures.

Pictures upload through `apiUpload()` rather than `apiSend()` — XHR, because
fetch can't report how much of the body has gone out. `showUploadBar()` pins
one bar above the bottom nav, visible from anywhere in a 31-unit plan. It runs
indeterminate while the browser shrinks the picture and again while the row is
written, and shows real bytes-sent percentage in between; a fill frozen at 100%
would say the wrong thing about both ends.

**Anyone who can see the plan can add a shelf photo.** Merchandising and packing
is the floor's job, and a photo that had to wait for the boss wouldn't get
taken. Deleting stays with `manage_conventions`, as does everything else on the
plan.

`src/lib/images.js` holds the rules shared with avatars — `parseImageDataUri()`
refuses anything that isn't base64 PNG/JPEG/WebP, **SVG especially**, since the
string lands in an `<img src>`. Caps differ by job: 400KB avatar, 800KB
resource, 900KB photo, all inside D1's 2MB row limit once base64 inflates them
by a third. `readImageScaled()` in `core.js` fits a picture inside a box
keeping its shape — 1400px for a resource, 1600px for a photo you have to read
a spine off — rather than centre-cropping it the way an avatar is cropped.

`layoutConflicts()` runs on every read and reports units hanging off the
footprint or overlapping, **in inches** — the whole point is that an invalid
plan can't look valid. It accepts either a raw row or an already-mapped
position; reading the wrong shape once made it find no conflicts at all, which
is the exact failure it exists to prevent. Arrange overrides
(`move_x/y/w/h`) sit on top of the baseline and are never a copy of it, so a
later change to a unit's real dimensions isn't silently ignored.

## Scheduling

**A shift doesn't have to belong to an event.** `convention_shifts.convention_id`
is nullable — NULL means an ordinary store shift. Migration 0012 rebuilt the
table to drop the NOT NULL (SQLite can't do it in place). This is deliberately
one shift model rather than two: the roster, the clock, the staff page and the
dashboard all keep working without knowing which kind they're looking at.
**Any query joining conventions must LEFT JOIN**, or store shifts vanish.

Two screens over that one model:

- **Schedule** (`/schedule`) — the store, over whatever range you ask for. The
  store's usual hours (`store_hours`, one row per weekday, 0 = Sunday) drive
  the coverage check. Convention shifts that fall in the range are shown
  read-only, since they belong to the event.
- **Event schedule** (`/conventions/:slug/schedule`) — reached from **Build**
  on the event's Full schedule card. Its day tabs cover the event's run plus its setup
day plus any date that already has shifts; a day nobody is on is amber, because
that's the one that needs you. Opening it lands on the first day with gaps,
unassigned shifts, or nobody on it.

### Spans and the rota

**Day, Week, 2 weeks, Month and Custom are one view, not five.** `resolveSpan()`
turns any of them into a start date and a number of days — the presets only
decide what that number is and where a step forward lands. Week and 2 weeks
snap back to Monday (a week starting Thursday isn't a week anyone thinks in),
Month is the **calendar** month so stepping through the year doesn't drift the
way a fixed 30 would, and Custom starts where you pointed it and steps by its
own length. Custom is capped at 62 days; a `0` clamps up to 1 rather than
falling through `|| 7` as "not given".

The chart is drawn from **whole Monday-to-Sunday weeks** whatever was asked
for, so a fortnight's two tables line up under each other and a Wednesday reads
as a Wednesday in both. Days the padding added carry `in_range: false` — they
hold their column so the grid stays square, but `rotaWeeks()` skips them, so
ten days from a Wednesday doesn't quietly show you that Monday's shifts.

`rotaWeeks()` builds the rows **server-side**, from the same day objects the
detail cards below are drawn from — a name appearing in one and not the other
would be the whole point of the screen going wrong. A person is a row only in
the week they actually work, so nobody carries a blank line through a month
they were off for; unassigned shifts share one row, sorted last, because
they're a hole in the week rather than a person.

The table scrolls sideways **inside its own card** with the name column pinned,
rather than pushing the page wide — 620px of columns doesn't fit a phone.
Tapping a column header selects that day; tapping a shift opens that shift,
since the chart is where you spot a wrong time.

A selected state is `--clock-bg` / `--clock-text`, **never `--ink` / `--paper`**
— in arcade those two are both near-black (#191223 on #1A1426) and the text
vanishes. The clock pair is a dark plate with legible text in all five
palettes. `.day-tab.on` had this bug and was fixed with it.

Only a `week` span offers **Fill from last week**: on a month, "last week"
isn't a thing the screen is showing.

**Coverage is the point of the screen.** `coverageGaps()` in `routes/schedule.js`
merges the day's shifts into stretches and reports the holes *inside hall
opening hours* — including a late start and an early finish, which are the two
that actually bite. A setup shift that ends before doors open contributes
nothing, deliberately. No hall hours for a day means no claim is made rather
than a false NO GAPS.

Shifts are tapped to edit in place, and **Copy this day** duplicates everyone
(times and break allotments included) onto an empty day — it refuses a target
that already has shifts rather than silently doubling them. **Fill from last
week** is the same idea a week wide: every store shift moves forward exactly
seven days, so Tuesday's people land on Tuesday and the hours they were built
against still apply. Event shifts are left where they are — a show doesn't
recur a week later. The card only appears on a week nobody is on yet, which is
the only week where filling is what you meant.

A new store shift defaults to **half an hour either side of the door** — someone
opens the till before the first customer and cashes out after the last. It's
derived from that day's hours rather than typed in (`SHIFT_PAD_MINUTES` in
`public/schedule.js`), so today that's 11:30–19:30 most days and 11:30–17:30 on
a Sunday, and changing the store's week moves every default with it.

### Stat holidays

The dates are worked out in `src/lib/holidays.js` — Ontario's nine public
holidays plus the August civic holiday, which isn't statutory but closes the
street anyway (`statutory: false`). Eight are a fixed date or the nth weekday
of a month; Good Friday hangs off Easter, so there's a computus in there. A
table of dates would be a thing to remember to refill every December.

What *isn't* a fact about the calendar is whether Panda Hobby opens, so that's
the only thing in `store_holidays` — sparse the same way `employee_availability`
is, a row only where the boss has actually decided. **No row means undecided,
and the schedule says so** in amber rather than quietly assuming the usual
hours; the day tab stays amber even when it's fully staffed, because that's
still the day on the week that needs you.

A decided holiday outranks the usual week: closed shuts the day and drops the
coverage check entirely (the holiday card already said so — no point saying it
twice), and short hours replace that weekday's, so both the coverage bar and
the new-shift defaults follow them. Short hours are both ends or neither.

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

- **Never bulk-edit source with PowerShell `Get-Content`/`Set-Content`.** In
  Windows PowerShell 5.1 `Get-Content` reads as ANSI, so a UTF-8 file round
  trips into mojibake — one find/replace turned every `—`, `·`, `′`, `×`, `✓`
  and `‹` in `shelves.js` into `â€"`, `Â·`, `â€²`… The UI is full of typographic
  characters, so this is guaranteed damage. Use the editing tools, or
  `[IO.File]::ReadAllText`/`WriteAllText` with an explicit UTF-8 encoding.
- **Style inputs by exclusion.** `input:not([type="checkbox"]):not([type="radio"])`,
  not a list of types — a listed-types rule silently skips any new input type.
- **`openConvention(slug, pushState)`** only resets the manage panel when `pushState`
  is true, so saving something doesn't collapse the editor you're working in.
- **Every management form has a jump button** on the card that displays its data.
  The forms sit at the bottom of the page; without the buttons they're unfindable.
- **`shelf_positions.board_name` is dead.** A board's name comes from the
  Resources entry assigned to its face. The column is still written by the
  booth template and copied when a plan is carried forward, but nothing reads
  it.
- **The `can_*` columns on `employees` are dead.** Superseded by the permission
  tables in migration 0002; nothing reads them.
- **Local dev uses a separate D1 database.** Data differs from production, and Google
  Sign-In needs `http://localhost:8787` as an authorized origin to work locally.
