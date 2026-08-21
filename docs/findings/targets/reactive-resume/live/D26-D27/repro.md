# D26/D27 — no `Hidden` switch, and clicking a section heading opens nothing

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


**Doc quotes**, `docs/guides/fitting-content-on-a-page.mdx`:

> `:58` — In the left sidebar, find the section you want to adjust, click on the section heading (not an item), and change the **Columns** setting.
>
> `:129` — To hide a section, click on the section heading in the left sidebar and toggle the **Hidden** switch.

## Probe and control

```
=== D26/D27 · PROBE: the Experience section (#sidebar-experience), BEFORE the click ===

- heading "Toggle Experience section" [level=3]:
  - button "Toggle Experience section" [expanded]:
    - img
- button "Pick an icon": 
- heading "Experience" [level=2]
- button "Section options":
  - img
- region "Toggle Experience section":
  - list:
    - listitem:
      - img
      - button "Cascade Studios Senior Game Developer"
      - button "Options for Cascade Studios":
        - img
  - button "Add a new experience":
    - img
    - text: Add a new experience

BEFORE — switches on the page                    8
BEFORE — switch names                            ["Full Width","Full Width","Full Width","Full Width","Allow Public AccessAnyone with the link can view and download the resume.","Hide Link Underline","Hide Icons","Hide Section Icons"]
BEFORE — getByRole('switch', {name: 'Hidden'})   0
BEFORE — page text contains "Hidden"             false

BEFORE — the section's aria-expanded              true

>>> clicking heading "Experience", exactly as the guide instructs <<<
AFTER — switches on the page                     8      (unchanged)
AFTER — getByRole('switch', {name: 'Hidden'})    0
AFTER — dialogs opened / menus opened            0 / 0
AFTER — lines that APPEARED on the page          []
AFTER — lines that DISAPPEARED (whole page)       []
AFTER — the section's aria-expanded              true  (was true)
AFTER — lines that left the SECTION itself       []

For contrast, the section's OWN toggle button:
  aria-expanded after pressing it                false
  lines that left the section                    ["Cascade Studios","Senior Game Developer","Add a new experience"]
  getByRole('switch', {name:'Hidden'}) now       0

=== D26/D27 · CONTROL: the real path works ===
Section options buttons inside the Experience section   1
menu items                                              ["Add a new item","Hide","Rename","Columns","Reset"]
column radios                                           ["1 Column","2 Columns","3 Columns","4 Columns","5 Columns","6 Columns"]
stored experience.columns after the real path           2
stored experience.hidden                                false
'hidden' is real in the data model                      true

The hide affordance exists as a MENU ITEM named "Hide" (section-menu.tsx:138), not a switch named "Hidden".
```

## What reproduced

- **No `Hidden` switch exists**, before or after the click. Eight switches are on the page; resolving each
  one's accessible name through `aria-label` *and* `aria-labelledby` gives
  `["Full Width" ×4, "Allow Public Access…", "Hide Link Underline", "Hide Icons", "Hide Section Icons"]`.
  None is named `Hidden`, and `getByRole('switch', {name: 'Hidden'})` is **0** throughout. The page text
  never contains the word.
- **Clicking the section heading opens nothing.** Zero dialogs, zero menus, no lines appeared, and the
  section's `aria-expanded` stayed `true`. The instruction simply has no effect.

### One refinement on the collapse detail

The hand-verification report recorded that clicking the heading *collapses* the section, removing
`["Cascade Studios","Senior Game Developer","Add a new experience"]`. Measured precisely here, that
belongs to a **different control**: clicking the `<h2>` "Experience" heading does nothing at all
(`aria-expanded: true → true`, no lines change), while the section's own **`Toggle Experience section`**
chevron is what collapses it and removes exactly those three lines. Both measurements agree on the
finding — the guide's instruction does not open anything and there is no `Hidden` switch — and this run
pins which element is which.

## Control — the real path works

From the same section: `Section options` → menu items
`["Add a new item","Hide","Rename","Columns","Reset"]` → `Columns` → radios
`["1 Column",…,"6 Columns"]` → `2 Columns` persists as `data.sections.experience.columns = 2`.

The hide affordance the doc reaches for exists too — as a **menu item named `Hide`**
(`-sidebar/left/shared/section-menu.tsx:138`, which renders `Show` or `Hide` depending on
`section.hidden`), not as a switch named `Hidden`. The `hidden` property is real in the data model
(`'hidden' in sections.experience` → `true`, value `false`); only the control the doc describes is fiction.

## Mechanism, re-read at this SHA

`grep -rn 'Hidden' apps/web/src` finds the word only as a proficiency-level label for level zero
(`level/combobox.tsx:15`, `dialogs/resume/sections/skill.tsx:208`,
`dialogs/resume/sections/language.tsx:127`) and never as a switch on a section.

## Verdict

**still reproduces**
