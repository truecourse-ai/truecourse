# F7 — `FormControl` stamps its id on an unlabelable wrapper

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


## Probe

Two surfaces, driven with Playwright's own accessibility computation, plus a direct
`label[for]` → `document.getElementById` resolution.

```
=== F7 · PROBE 1: the Create-a-resume dialog ===

- dialog "Create a new resume":
  - heading "Create a new resume" [level=2]:
    - img
    - text: Create a new resume
  - paragraph: Start building your resume by giving it a name.
  - text: Name
  - textbox "Name"
  - button "Generate a random name":
    - img
  - paragraph: "Tip: You can name the resume referring to the position you are applying for."
  - text: Slug
  - group:
    - group: http://127.0.0.1:54490/guardowner/
    - textbox
  - paragraph: This is a URL-friendly name for your resume.
  - text: Tags
  - textbox "Add keyword":
    - /placeholder: Add a keyword...
  - status
  - paragraph: Press Enter or , to add or save the current keyword.
  - paragraph: Tags can be used to categorize your resume by keywords.
  - group "Create resume with options":
    - button "Create"
    - button:
      - img
  - button "Close":
    - img
    - text: Close

getByLabel('Name').count()                               1
getByLabel('Slug').count()                               0
getByLabel('Tags').count()                               0
CONTROL getByRole('textbox', {name:'Name', exact:true})  1
getByRole('textbox', {name:'Slug'})                      0

label for= -> target resolution inside the dialog:
label "Name"       for=_r_3h_-form-item     -> target=INPUT              OK
label "Slug"       for=_r_3j_-form-item     -> target=FIELDSET           BROKEN
label "Tags"       for=_r_3l_-form-item     -> target=DIV                BROKEN


=== F7 · PROBE 2: the builder sidebar ===

getByRole('slider', {name: 'Sidebar Width'})   0
sliders on the page                            1
slider attributes  [{"tag":"INPUT","ariaLabel":null,"ariaLabelledby":null,"id":"base-ui-_r_k3_"}]

spinbutton census (name / value):
  spinbutton: (ANONYMOUS): "100"
  spinbutton "Rotation": "0"
  spinbutton "Aspect Ratio": "1"
  spinbutton "Border Radius": "0"
  spinbutton "Border Width": "0"
  spinbutton "Shadow Width": "0"
  spinbutton: (ANONYMOUS): "30"
  spinbutton "Font Size": "10"
  spinbutton "Line Height": "1.5"
  spinbutton "Font Size": "12"
  spinbutton "Line Height": "1.5"
  spinbutton "Margin (Horizontal)": "16"
  spinbutton "Margin (Vertical)": "16"
  spinbutton "Spacing (Horizontal)": "12"
  spinbutton "Spacing (Vertical)": "8"

total spinbuttons                                    15
spinbuttons with NO accessible name                   2
getByRole('spinbutton', {name: 'Font Size'})          2   <- CONTROL: correctly named
getByRole('spinbutton', {name: 'Size', exact: true})  0

=== F7 · the SECOND family: FormLabels pointing at ids no element carries ===
label "Size"               for=_r_1v_-form-item     -> target=NOTHING
label "Website"            for=_r_2v_-form-item     -> target=NOTHING
label "Sidebar Width"      for=_r_jv_-form-item     -> target=DIV[role=group]
label "Font Family"        for=_r_kf_-form-item     -> target=BUTTON[role=combobox]
label "Font Weights"       for=_r_kj_-form-item     -> target=BUTTON[role=combobox]
label "Font Family"        for=_r_kr_-form-item     -> target=BUTTON[role=combobox]
label "Font Weight"        for=_r_kv_-form-item     -> target=BUTTON[role=combobox]
label "Icon"               for=_r_lr_-form-item     -> target=BUTTON
label "Type"               for=_r_lu_-form-item     -> target=BUTTON[role=combobox]
label "Language"           for=_r_m9_-form-item     -> target=BUTTON[role=combobox]
label "Format"             for=_r_md_-form-item     -> target=BUTTON[role=combobox]

DOM ids used more than once  [["_r_jv_-form-item",2]]
```

## What reproduced

- **The headline, to the character.** `label "Name"` resolves to an `INPUT`; `label "Slug"` resolves to a
  `FIELDSET`; `label "Tags"` resolves to a `DIV`; `label "Sidebar Width"` resolves to a `DIV[role=group]`.
  `getByLabel('Slug')` and `getByLabel('Tags')` are both **0**.
- **The slider** is an `INPUT` with `aria-label: null` and `aria-labelledby: null`;
  `getByRole('slider', {name: 'Sidebar Width'})` is **0** while one slider exists on the page.
- **The corrected count holds: 2 of 15, not 15.** There are **15** spinbuttons and exactly **2** are
  anonymous — Picture → Size (value `"100"`) and the Sidebar Width numeric (value `"30"`). The other 13
  are correctly named.
- **The second family reproduces.** `label "Size"` and `label "Website"` point at ids **no element in the
  document carries** (`-> target=NOTHING`).
- **The duplicate id reproduces.** `DOM ids used more than once: [["_r_jv_-form-item", 2]]` — two
  `FormControl`s inside one `FormItem` (`layout/index.tsx:71` and `:86`) receive the same id.

## Control — the measurement instrument is fine

`getByLabel('Name')` = **1** in the same dialog; `getByRole('textbox', {name: 'Name', exact: true})` = **1**;
`getByRole('spinbutton', {name: 'Font Size'})` = **2** in the sidebar. Correctly wired fields on the same
pages resolve normally, so the pattern is the fault, not the page.

## Mechanism, re-read at this SHA

```
packages/ui/src/components/form.tsx:30-42   FormLabel → <Label htmlFor={`${id}-form-item`} …>  (htmlFor at :38)
packages/ui/src/components/form.tsx:44-61   FormControl → useRender({ props: { id: `${id}-form-item` } })  (id at :52)
apps/web/src/dialogs/resume/index.tsx:393-395            FormControl render={<InputGroup>}  → Slug (a <fieldset>)
apps/web/src/dialogs/resume/index.tsx:425-433            FormControl render={<ChipInput …>} → Tags (a <div>)
.../-sidebar/right/sections/layout/index.tsx:71-84       FormControl render={<Slider …>}
.../-sidebar/right/sections/layout/index.tsx:86-88       a SECOND FormControl in the same FormItem
```

## Verdict

**still reproduces** — headline and both corrected sub-claims, including the 2-of-15 count, the two
dangling `for=` targets and the duplicate DOM id.
