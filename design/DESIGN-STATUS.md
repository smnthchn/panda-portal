# Design status

Current design: v2 (2026-08-13)

| Version | Date | Notes |
|---|---|---|
| v1 | 2026-08-13 (15:11) | First export. Only version with `Shelf plan.dc.html`. |
| v2 | 2026-08-13 (18:47) | Longer README (adds shelf plan spec, repo mapping). No shelf plan mockup file, so open v1 to see it. |

Bundles are kept out of git (`.gitignore`); they live on disk and in backups.

## Screens

Not audited yet. Fill in on the next `/designin` or `/designbrief` for this project (screen, design version, built version, notes).

## Where the build differs from the design

- **Sales bonus (Home card and the boss's Sales bonus page), built 2026-11-20
  with no design.** Not in v1 or v2. The meter on the Home card is a
  Christmas tree made from a picture Sam supplied (`public/bonus-tree.webp`,
  drawn by `bonusMeterHtml()` in `public/bonus.js`, `.bonus-tree` in
  `style.css`). It sits on a white panel in every theme because the picture
  has a white background. Sam has not signed off the look yet: see
  `docs/bonus-plan.md` and HANDOFF.md.
