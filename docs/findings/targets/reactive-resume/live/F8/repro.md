# F8 — the dashboard's `Sort by` and `Filter by` comboboxes have no accessible name

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


## Probe and control

```
F8 dashboard URL: http://127.0.0.1:54490/dashboard/resumes

=== F8 · PROBE: Playwright's aria snapshot of the dashboard control strip ===
  - separator
  - text: Sort by
  - combobox:
  - text: Filter by
  - combobox:
    - text: Filter by
    - textbox "Search resumes..."

combobox count on dashboard                      2
getByRole('combobox', {name: /sort/i})           0
getByRole('combobox', {name: /filter/i})         0
getByRole('combobox', {name: 'Last Updated'})    0
getByLabel('Sort by')                            0
getByLabel('Filter by')                          0

combobox attributes:
[
 {
  "tag": "BUTTON",
  "ariaLabel": null,
  "ariaLabelledby": null,
  "id": "base-ui-_r_4_",
  "text": "Last Updated"
 },
 {
  "tag": "BUTTON",
  "ariaLabel": null,
  "ariaLabelledby": null,
  "id": "base-ui-_r_7_",
  "text": "Filter by"
 }
]

every <label> on the dashboard:
[{"text":"Sort by","htmlFor":null},{"text":"Filter by","htmlFor":null}]

=== F8 · CONTROL: the search field on the SAME strip is addressable ===
getByRole('textbox', {name: 'Search resumes...'})  1
```

Both comboboxes exist; neither can be addressed by name; and the two visible labels carry no `for` at
all, so they are decorative text. A `combobox` takes no accessible name from its contents.

**Control:** the search field on the same control strip *is* addressable —
`getByRole('textbox', { name: 'Search resumes...' })` → **1**. Screenshot:
[`dashboard-control-strip.png`](./dashboard-control-strip.png).

## Mechanism, re-read at this SHA

`apps/web/src/routes/dashboard/resumes/index.tsx:106-136` — a bare `<Label>` wrapping `<Trans>Sort by</Trans>`
at `:106-108`, the `<Combobox>` at `:109-118` carrying only `placeholder={t\`Sort by\`}`, the `Filter by`
`<Label>` at `:124-126` and its `multiple` `<Combobox>` at `:127-136`. No `FormItem`, so no `htmlFor` is
attempted; no `aria-label` and no `aria-labelledby` anywhere in the block.

## Verdict

**still reproduces**
