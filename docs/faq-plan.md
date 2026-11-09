# FAQ plan

Agreed with Sam on 2026-10-21. **Status (2026-11-09):** what's live (the
Shopify metaobjects, the Panda FAQ block on `/pages/faq`, the redirect, and
the old app's removal) is described in CLAUDE.md's FAQ section. This file now
holds only what isn't built: phase 3, the portal FAQ editor, plus the cleanup
left over from the cutover. CLAUDE.md gets the editor's section once it ships.

- Clickable mockup: `design/mockups/faq-editor.html` (screenshots beside it).
  It's a reference for the look and the behaviour, not code to copy.

## Why

Sam wants the FAQ out of paid SaaS and editable from the portal, as one of
the first steps in making the portal the store's back office.

## How the editor fits together

- **Shopify holds the content; the portal is the editor.** Sections and
  questions are metaobject entries. The portal reads and writes them through
  the Admin GraphQL API. There's no second copy in D1 to drift out of sync.
- The data model, the Panda Portal app, its secrets and scopes, and the rule
  for testing against the live store are in CLAUDE.md's FAQ section.
- **D1 holds what Shopify doesn't**: the change history (who changed what, with
  a snapshot of the wording before), and who moved what to the Trash and when.

The Trash is a flag, not a copy: a trashed question is set to Draft and marked
`trashed`, so it's off the site and out of the portal list but nothing is lost.
**Delete forever** is the only thing that deletes the Shopify entry.

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

## Phase 3: what to build

3. **The portal FAQ screens** as above, plus the `faq` and `manage_faq`
   permissions (a migration seeding every role's default) and the D1 tables
   for history and trash records.

## Other open work

- **Step 20, cleanup** (ask Sam first: it deletes on the live store). Clean
  up: delete the theme copy (`189206954290`), the empty `/pages/avada-faqs`
  page, and the 2021 body text on `/pages/faq`.
- **Stale answers. UNDECIDED.** Content fixes are Sam's call: two answers
  mention Covid or the pandemic, one links to pandahobby.store, and the
  Markham answer needs checking (see the README in `C:\dev\faq-migration\`).
  All three are still on the live page (checked 2026-11-09). Until phase 3
  ships, they're fixed in Shopify admin.

## Not in this plan: Shopify Knowledge Base

Shopify's Knowledge Base app holds the FAQs and store facts that AI shopping
assistants get through Shopify (22 FAQs and 36 unpublished suggested facts on
2026-10-21). It can't run the website FAQ: Shopify doesn't show its entries
on the storefront, the `shopify--qa-pair` type has no storefront access, and
answers are plain text. **A separate build, to decide later** (Sam,
2026-10-21). Either the portal copies Live questions into it as plain text
(the app's keys can write that type, but it isn't an official route), or Sam
writes a separate set of answers aimed at AI.

## Risks

- **Rich text conversion.** Shopify stores rich text as its own JSON, not
  HTML; the editor converts both ways, which is why formatting is limited.
- **Saves are live.** A Live question changes the site on Save; the history
  and Draft status are the safety nets.
- **Shopify API versions** retire yearly; the portal's pinned version needs a
  bump each year.
