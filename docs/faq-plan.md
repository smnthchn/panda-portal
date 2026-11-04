# FAQ plan

Agreed with Sam on 2026-10-21. Nothing is built yet. This file holds what's
agreed; CLAUDE.md gets a section once it ships.

- Clickable mockup: `design/mockups/faq-editor.html` (screenshots beside it).
  It's a reference for the look and the behaviour, not code to copy.
- Content export: `C:\dev\faq-migration\` (75 questions, 11 sections, plus a
  README listing stale content and every link that points at the old FAQ).

## Why

The store FAQ lives in the **SB: FAQ HelpCenter** Shopify app ($99 USD a year),
served at `pandahobby.ca/apps/help-center`. Sam wants it out of paid SaaS and
editable from the portal, as one of the first steps in making the portal the
store's back office.

## How it fits together

- **Shopify holds the content; the portal is the editor.** Sections and
  questions are metaobject entries. The portal reads and writes them through
  the Admin GraphQL API. There's no second copy in D1 to drift out of sync.
- **Merchant-owned metaobject types**, not app-owned (`$app:`). App-owned
  entries are deleted if the app is ever uninstalled; merchant-owned ones
  survive, and stay editable in Shopify admin as a fallback.
- **The "Panda Portal" app** in the Shopify Dev Dashboard, client-credentials
  grant, same pattern as the other custom apps. Secrets `SHOPIFY_SHOP`,
  `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` are set as wrangler secrets
  and in `.dev.vars` (2026-10-21). Scopes: `read_metaobjects`,
  `write_metaobjects`, `read_metaobject_definitions`,
  `write_metaobject_definitions`. **There's no test store**, so local dev talks
  to the live store: keep local testing to reads unless Sam OKs a write.
- **D1 holds what Shopify doesn't**: the change history (who changed what, with
  a snapshot of the wording before), and who moved what to the Trash and when.
- **The website page** is a theme section that reads the metaobjects with
  Liquid. It needs `access.storefront: PUBLIC_READ` on both types.

### Data model

`faq_section`
- `name` (single line text, required)
- `sort_order` (integer)
- `hidden` (boolean): hides the section and everything in it from the site
- `trashed` (boolean)

`faq_question`, with the **publishable** capability (Active = Live, Draft = Draft)
- `question` (single line text, required)
- `answer` (rich text, required)
- `section` (metaobject reference to `faq_section`, required)
- `sort_order` (integer)
- `trashed` (boolean)
- **handle = the old anchor slug** (`how-long-does-shipping-take`), so the page
  can give each question `id="hc-<handle>"` and old links that jump to a
  specific question keep working.

The Trash is a flag, not a copy: a trashed question is set to Draft and marked
`trashed`, so it's off the site and out of the portal list but nothing is lost.
**Delete forever** is the only thing that deletes the Shopify entry.
**To verify in phase 1:** that Liquid really skips Draft entries of a
publishable type; if it doesn't, the theme section filters on status itself.

## Portal screens

Placement: a new **Website** group in the sidebar (between Operations and
Reference) with **FAQ** in it. On a phone it appears under More, like every
sidebar-only screen.

### Who sees what (Sam, 2026-10-21)

Two permissions, the same split as `conventions` / `manage_conventions`, set
per role and per person in Users & Roles:

- **`faq`: view.** Defaults on for boss, staff and seasonal staff (seasonal
  ranks with staff), off for volunteers.
- **`manage_faq`: edit.** Defaults on for **boss only**.

Staff get a read-only FAQ screen: the sections and questions, answers that
open in place, and search, so they can look up what the site tells customers.
They see **only what customers see**: Live questions in shown sections. No
Draft questions, hidden sections, LIVE/DRAFT pills, Edit buttons, drag
handles, New question, New section or Trash. The server enforces the same
line: every write endpoint requires `manage_faq`, and the read endpoint
leaves drafts, hidden sections and the Trash out for anyone without it.

### FAQ list

- Every section listed in site order. A section opens and closes by clicking
  its bar, and shows its question count, an **Edit** link and a HIDDEN tag
  when hidden. A hidden section is drawn dashed and muted.
- **Clicking a question expands its answer in place**, so Sam can read down a
  section and spot what needs editing without leaving the page. Only the
  **Edit** button under the answer opens the edit screen. Several answers can
  be open at once.
- Each question shows a **LIVE** or **DRAFT** pill.
- **Drag ⋮⋮ to reorder** sections, and questions within a section. Must work
  by touch on a phone too (pointer events, not HTML5 drag and drop, which is
  mouse-only).
- **Search** across questions and answers; matches open their sections, and
  dragging is off while searching.
- Header buttons: **Trash · N**, **View on site**, **New question**.
- **+ New section** under the list: a name, and where it goes ("At the top",
  "After Shipping", …, defaulting to the end). A new section stays off the
  site until it has at least one Live question.

### Section edit (inline, under the section's bar)

- Rename.
- **Shown / Hidden.** Hidden takes the section and all its questions off the
  site; nothing is deleted, and Shown brings it all back.
- **Move to trash**, which takes its questions with it.

### Edit question

- Question; answer with **bold, italic, links and bullet lists only**; section
  (with **+ New section…** at the bottom of the list); Live / Draft.
- **Move to trash**, **Preview**, **Save**. A note says a Live question
  changes the website as soon as it's saved.
- A new question starts as a Draft.
- **Changes**: every save, restore, trash and restore-from-trash, with who and
  when. History only grows; nothing in it is ever erased.
- **Restore** on a past version fills the editor with that version's wording
  (question and answer only; section, position and Live/Draft stay as they
  are now) and shows a bar: "Showing the version from Oct 22. Save to put it
  back, or Cancel." Nothing changes on the site until Save, and the restore
  is logged, so a restore can itself be undone.

### Trash

- Questions and whole sections. Each row says where it came from, who moved
  it there and when.
- **Restore** brings a question back as a **Draft**, and a section back
  **Hidden**, so nothing reappears on the site by surprise.
- **Delete forever** asks for confirmation on the row first. **Empty Trash**
  asks before clearing everything. Both are permanent.
- **The Trash never empties itself** (Sam, 2026-10-21). Things stay until a
  boss deletes them forever.
- **A section in the Trash opens to list its questions**, each with its own
  Restore and Delete forever. Restoring one question asks where it goes: a
  current section, or "Its old section (name)", which brings that section
  back Hidden with only that question in it. Either way the question comes
  back as a Draft. Restore on the section row brings back the section with
  whatever questions are still in it.

## The website page

A new page at `/pages/faq`, replacing the 2021 page there (`/pages/avada-faqs`
is empty and can go too). Rendered from the metaobjects: sections in order,
hidden sections and Draft questions skipped, questions as expanding answers,
`id="hc-<handle>"` on each, and FAQPage structured data.

### Built as an app block, not theme code (Sam, 2026-10-21)

The FAQ is a **theme app extension** in the Panda Portal app: an app block
called **Panda FAQ**. Its code lives in the app, so no theme file is edited.

- **Why:** Sam's worry was losing the FAQ when the theme is updated. Shopify
  copies theme-editor customizations, app blocks included, into an updated
  theme version; hand-edited theme code is not copied. On a different theme
  it's **Add section → Apps → Panda FAQ** in the theme editor, no code. A
  portal button that writes theme files was considered and dropped: it needs
  `write_themes` plus a theme-file exemption that Shopify approves per app,
  and developers report being blocked even after approval.
- **The app project** (`shopify.app.toml` plus `extensions/panda-faq/`) is
  linked to the existing Dev Dashboard app with `shopify app config link`,
  which pulls the app's current settings so a deploy doesn't change its
  scopes or URLs. `shopify app deploy` releases a new app version; it writes
  nothing to the store. Shopify CLI must be signed in to the account that
  owns the Panda Portal app (Sam signs in).
- **Confirmed by a test block, 2026-10-21** (app version `faq-test-1`, shown
  on the home page of theme copy `189206954290`, a temporary Draft question
  added and then deleted): an app block reads our merchant-owned
  `faq_section` / `faq_question` entries; all 75 come back with or without
  `paginate … by 250` (keep the paginate as a guard as the FAQ grows);
  **Draft questions are left out** of `shop.metaobjects.faq_question.values`;
  `| sort: 'sort_order'` orders sections correctly; `q.section.value.name`
  follows the reference; `{{ q.answer | metafield_tag }}` renders the rich
  text with lists, bold and emoji intact.
- **Liquid gotcha:** a metaobject's handle is `entry.system.handle`, not
  `entry.handle` (that's blank). `faq-1` used `.handle`, so every question
  landed in every section; fixed in `faq-2` (2026-10-22). Avoid `continue`
  inside a `capture`; wrap in an `if`.
- **Checked on theme copy `189206954290`, 2026-10-22** (Sam made the
  `panda-faq` template): 75 questions, each once, in the right sections and
  order; section counts right; 9 links; valid FAQPage data with 75 entries;
  old `#hc-…` and `#hc-…-question` links open their answer. Screenshots in
  `C:\dev\faq-migration\website-preview\`.
- **Released 2026-10-21 as app version `faq-1`** (the test block removed).
  Code: `shopify-app/extensions/panda-faq/` (`blocks/faq.liquid`,
  `assets/faq.css`, `assets/faq.js`). Title, accent and button colours, and
  the contact box text are block settings in the theme editor.
- **Setup in the store:** a page template named **`panda-faq`** (made in the
  theme editor so it carries over on updates; not `faq`, which the theme
  already has) with the theme's page-content section removed and the Panda
  FAQ block added. Preview without touching the live page with
  `/pages/faq?view=panda-faq&preview_theme_id=<copy id>`. **Assigning the
  page to the template is a cutover step:** a page's template is set on the
  page, not per theme, so it changes the live site too. A theme without a
  `panda-faq` template falls back to the default page template.

**Layout B, the sidebar** (Sam, 2026-10-21). Mockup:
`C:\dev\faq-migration\website-mockup\faq-page.html` (switch to "B · Sidebar";
screenshots beside it). It was drawn inside a saved copy of the live site, so
the header, fonts and colours are the theme's own.

- "Frequently Asked Questions" title with nothing under it (Sam: no intro
  line), then a search box whose placeholder is just "Search". It filters
  every answer at once and says how many matched ("1 answer for 'deposit'"),
  with a no-results message pointing to customer service.
- Desktop: a list of sections down the left that stays in view while
  scrolling, each with its question count; every section and question on one
  page to the right, each section under its own heading.
- Phone: the section list becomes a "Jump to a section" dropdown above the
  questions.
- Questions are the theme's own expanding FAQ items (`faq__details`); an open
  question turns the accent colour.
- A "Still have a question?" box at the end with the customer service email,
  hours (Monday to Friday, 12pm to 5pm) and a Contact us button to
  `/pages/contact-us`.
- The theme caps FAQ sections at 680px wide (`.faq--regular`); this layout
  needs about 1100px, so the section sets its own width.

## Import

From `C:\dev\faq-migration\faq-export.json`, in the app's order, all Live and
all sections Shown. Answers are converted to Shopify's rich text format;
inline styles are already stripped, and runs of blank paragraphs are
collapsed during the import (several answers have large gaps today). Content
fixes are Sam's call before or after the import: two answers mention Covid or
the pandemic, one links to pandahobby.store, and the Markham answer needs
checking (see the export's README).

## Phases

1. **Shopify setup and import. Done 2026-10-21.** Types `faq_section`
   (`gid://shopify/MetaobjectDefinition/28479422770`) and `faq_question`
   (`…/28479488306`) created; one test question imported and checked by Sam
   in Shopify admin; then all 11 sections and 75 questions, all Live, all
   sections Shown. Read back and compared with the export: counts, wording,
   sections, order, status and all 9 links match. 12 missing spaces after
   full stops and colons were added (3 answers, Sam's OK); no other wording
   changed, and Covid/pandahobby.store/Markham are still as they were.
   Scripts, log and per-entry summary: `C:\dev\faq-migration\scripts\` and
   `logs\` (`shopify_faq.py verify` re-runs the comparison).
2. **The website page.** Build layout B as the Panda FAQ app block (test
   block first, to confirm it can read the FAQ), release it, add it to a copy
   of the theme on a new FAQ page template, Sam previews, then the same in the
   live theme. Then the cutover: redirect `/apps/help-center` to
   `/pages/faq` (check old `#hc-` links land on the right question), and
   repoint every link listed in the export README, including the Vault email
   template. Set the FAQ page's search engine listing description in Shopify
   admin (Pages → FAQ): with none set, Shopify uses the 2021 page text, so
   Google and link previews would still show "FAQ COVID Is Panda Hobby
   open?…". Add a line to the store's `agents.md` pointing AI tools to
   `/pages/faq` for shipping, pre-order, pickup, Rewards and Vault questions.
   Its source is `templates/agents.md.liquid` in the live theme, and the same
   content is served at `/llms.txt` and `/llms-full.txt`, so it's one edit.
   It only has the restricted `agents` Liquid object (`shop` renders blank),
   so write the URL out in full. Until phase 3 ships, edits happen in Shopify admin.
3. **The portal FAQ screens** as above, plus the `faq` and `manage_faq`
   permissions (a migration seeding every role's default) and the D1 tables
   for history and trash records.
4. **Uninstall SB: FAQ HelpCenter** once the new page has been live and
   checked.

Phases 1, 2 and 4 can land before phase 3 (see Deadline).

## Cutover checklist

Written 2026-10-23. Live theme: **"2026 June - Sam Testing"**
(`185871630642`, Empire 12.2.1). The live site picks up the new page at step
D; everything before it is invisible to customers. Claude can't drive the
admin themes page (it doesn't render in the automated Chrome tab) and the
app has no theme or navigation scopes, so the clicks are Sam's and Claude
checks each step from the storefront.

**Progress:** A1, A2, B, C and D done 2026-10-23: `/pages/faq` is live on
the panda-faq template in the live theme. Checked on the live site: 75
questions, right sections and order, 9 links, FAQPage data with 75 entries,
the new meta and og descriptions, no 2021 text on the page, and old
`#hc-…` / `#hc-…-question` links plus the new banner link open their answer.
Screenshots in `C:\dev\faq-migration\website-live\`. Step 14 done the same
day. Old app page still answering (it's the safety net until F).

**Step E done 2026-10-26.** Sam made each change and Claude checked it with
`C:\dev\faq-migration\scripts\check_links.py` (22 old links → 0): menus
(main, phone, footer; the header utility bar is a menu too, so it came
along), both homepage banners (and the "or FAQ" typo), the contact page
link, the pre-order template link (`#hc-what-does-pre-order-mean`), and
CustomerHub (now one FAQ item of type PAGE, handle `faq`, replacing two
typed links). `agents.md` has the Store Questions section between Legitimate
Contact and Commerce Protocol; the first paste landed inside the UCP section
and was moved. `llms.txt` and `llms-full.txt` match. A crawl of 55 pages
(every sitemap page, blog post and article, plus home, collections/all, a
product, cart and search) found no `apps/help-center` links. **Next: F,
from about 2026-10-30** (a week after go-live).

**Shopify notification emails, scanned 2026-10-26** (read-only, all 49
customer templates' code via the admin editor; the templates are built with
the Orderly Emails app). Only **Shipping confirmation** links to the old
app: a "FAQ" link to `#hc-my-tracking-is-not-updating` (line ~481). Change
it in Orderly Emails (the source; an edit made only in Shopify's editor may
be overwritten when Orderly republishes) to
`https://pandahobby.ca/pages/faq#hc-my-tracking-is-not-updating`. Every
Orderly template also has a faint **"BROWSE" row (SHOP | ABOUT US | FAQ)**
under the QR code, near the bottom: SHOP goes to pandahobby.ca, but ABOUT
US and FAQ go to `https://pandahobby.store/pages/about-us` and
`/pages/faq`. The .store domain forwards, so they work, but **Sam wants no
.store links**: change both to pandahobby.ca in Orderly's shared footer
(close-up: `C:\dev\faq-migration\email-browse-links.png`), then Claude
re-scans all 49.

**Update 2026-10-26:** Sam changed Orderly's Site links to pandahobby.ca and
Claude began copying each Orderly email into Shopify: 29 of 47 done and
verified, 18 left (paused when Sam left). Progress and the to-do list:
`C:\dev\faq-migration\logs\email-export-log.csv`; method in the
`shopify-notification-emails` memory. Rescan all templates once finished.

**Done 2026-10-27:** all 45 Orderly-designed notifications are copied and
verified. A rescan of all 47 templates found 0 `pandahobby.store` and 0
`help-center` links. The two B2B emails were left on Shopify's default
template by Sam's choice (2026-10-28). Neither has an old link.

**A. Decide (Sam)**
1. The FAQ page's search description (Google and link previews). Today it
   falls back to the 2021 COVID text. **Decided 2026-10-23:** "Answers to
   common questions about shipping, pre-orders, in-store pickup, Panda
   Rewards, Panda Vault and trade-ins at Panda Hobby."
2. Where the homepage "Free Shipping" banner points. Today it's
   `#hc-cannot-ship-to-address-error`, a question that doesn't exist.
   **Decided 2026-10-23:** the Canada rates question,
   `https://pandahobby.ca/pages/faq#hc-how-much-is-shipping-canada`.
3. Optional before go-live: fix the stale answers (two Covid/pandemic
   mentions, the pandahobby.store link, the Markham answer) in Shopify admin
   → Content → Metaobjects → FAQ question.

**B. Live theme, invisible until D (Sam, theme editor)**
4. Create page template **panda-faq** (based on Default page), remove the
   page-content section, Add section → Apps → **Panda FAQ**, match the
   copy's settings (accent colour), Save. Nothing uses the template yet.

**C. Page settings (Sam, Shopify admin → Pages → FAQ)**
5. Search engine listing: set the description from A1. Leave the 2021 body
   for now (it's the fallback if D is rolled back).

**D. Go live (Sam), then Claude checks**
6. Pages → FAQ → Theme template → **panda-faq** → Save. `/pages/faq` is now
   the new FAQ.
7. Claude: same checks as the preview (75 questions, sections, order, links,
   FAQPage data, old `#hc-` links), plus desktop and phone screenshots.
   **Rollback:** set the template back to Default page; the 2021 page
   returns and the old app is still installed.

**E. Repoint links (Sam), then Claude crawls for leftovers**

Found on the live site 2026-10-23: 7 links to `/apps/help-center` on every
page (menus, header, footer, account menu), plus the homepage banners, the
contact page and pre-order product pages.

8. Online Store → Navigation: main menu "Panda" (parent links to the FAQ)
   and its "FAQ" item, the footer "Quick links" FAQ item, and any other menu
   with FAQ → `/pages/faq`.
9. Theme editor, header: utility bar "FAQ" link → `/pages/faq`.
10. Theme editor, home page: highlights banner "FAQ" block → `/pages/faq`;
    "Free Shipping" block → the target from A2.
11. Theme editor, contact page: the "FAQ - CLICK HERE" link in the rich
    text section → `/pages/faq`.
12. Theme editor, product template **pre-order**: the "what does pre-order
    mean" link → `/pages/faq#hc-what-does-pre-order-mean`.
13. CustomerHub app settings: the account menu "FAQ" item → `/pages/faq`.
14. Claude: Vault email template
    (`C:\dev\shipments\_TEMPLATE\vault-email-template.md`) →
    `https://pandahobby.ca/pages/faq#hc-combine-orders-and-save-on-shipping`.
15. Claude: `agents.md` line. Sam pastes it into
    `templates/agents.md.liquid` in the live theme's code editor, as a new
    section right after "## Legitimate Contact":

    ```
    ## Store Questions

    Answers about shipping (Canada, USA and international), pre-orders and deposits, in-store pickup, orders and refunds, out-of-stock items, Panda Rewards, Panda Vault and trade-ins are on the FAQ page: https://pandahobby.ca/pages/faq
    ```
16. Claude: crawl the home page, a product, a pre-order product, the contact,
    Vault and Ship My Vault pages, and the menus for any `apps/help-center`
    left.

**F. Keep the old app as a safety net, then remove it**
17. Leave SB FAQ installed for about a week after D, so a rollback has
    somewhere to land. Its page stays reachable by old links meanwhile.
18. Uninstall SB: FAQ HelpCenter (Sam), by 2026-12-15 at the latest.
    **2026-11-03: on hold.** The yearly charge came before the expected
    Dec 22 renewal. Sam is asking the developer for a refund and will
    uninstall once that's settled. The site was ready that day: a crawl of
    27 live pages found no `apps/help-center` links.
    **Done 2026-11-03:** the developer hadn't collected the charge yet and said
    Sam could uninstall without being charged, so Sam uninstalled the app. The
    redirect (step 19) was saved the same day; Shopify accepted the `/apps/` path,
    so the fallback isn't needed. Tested: `/apps/help-center` (with or without a
    trailing slash or query) 301s to `/pages/faq`, and
    `#hc-how-much-is-shipping-canada` survives the redirect and opens that
    question. The redirects page now lives at
    admin.shopify.com/store/panda-hobby-store/redirects (Navigation moved under
    Content → Menus). **Found while testing:** the theme's sticky header (138px
    on desktop) covers the question title when a `#hc-…` link opens it, because
    `faq.css` only leaves 24px (`scroll-margin-top`). Needs a fix and an app
    release. Sam (2026-11-03): leave it for now.
19. Online Store → Navigation → URL Redirects: `/apps/help-center` →
    `/pages/faq` (Sam). Shopify only applies a redirect when the path would
    404, so it can only work once the app is gone. **Unverified:** whether
    Shopify accepts a redirect from an `/apps/…` path. Claude tests old links
    (with and without `#hc-…`) right after. **Fallback if it's refused:** give
    the Panda Portal app an app proxy at `/apps/help-center` (needs the
    `write_app_proxy` scope and an app release) that answers with a 301 to
    `/pages/faq`, from a small route on the portal Worker. Browsers keep the
    `#hc-…` part through a redirect, so old question links still work.
20. Clean up: delete the theme copy, the empty `/pages/avada-faqs` page, and
    the 2021 body text on `/pages/faq`.

## Not in this plan: Shopify Knowledge Base

Shopify's Knowledge Base app holds the FAQs and store facts that AI shopping
assistants get through Shopify (22 FAQs and 36 unpublished suggested facts on
2026-10-21). It can't run the website FAQ: Shopify doesn't show its entries
on the storefront, the `shopify--qa-pair` type has no storefront access, and
answers are plain text. **A separate build, to decide later** (Sam,
2026-10-21). Either the portal copies Live questions into it as plain text
(the app's keys can write that type, but it isn't an official route), or Sam
writes a separate set of answers aimed at AI. Not part of the Dec 22 deadline.

## Deadline

The SB FAQ subscription renews on **2026-12-22**. Uninstall it before then,
with a week's margin: the new page live and links repointed by about
**2026-12-15**. If phase 3 isn't ready by then, phases 1, 2 and 4 go ahead
without it.

## Risks

- **Rich text conversion.** Shopify stores rich text as its own JSON, not
  HTML; the editor converts both ways, which is why formatting is limited.
- **Saves are live.** A Live question changes the site on Save; the history
  and Draft status are the safety nets.
- **The block depends on the app.** Uninstalling the Panda Portal app would
  remove the block from the page (the questions survive; they're
  merchant-owned). Theme updates keep it.
- **Shopify API versions** retire yearly; the portal's pinned version needs a
  bump each year.
