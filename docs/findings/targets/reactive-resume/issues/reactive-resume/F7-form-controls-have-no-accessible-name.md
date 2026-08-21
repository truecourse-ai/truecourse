---
finding: F7
target: AmruthPillai/Reactive-Resume
route: public issue
title: "FormControl stamps the label's target id on a non-labelable wrapper, so Slug, Tags and the Sidebar Width slider have no accessible name"
labels: "bug, status: needs triage (applied automatically by 1-bug-report.yml); suggested in body: v5, area: builder"
status: filed
filed_url: https://github.com/amruthpillai/reactive-resume/issues/3369
filed_at: 2026-08-21
reverified: "yes (main @ 3221afda9ddfb03d6cce87927b0ce47338b4cfa8, which is both the commit our corpus tested and today's default-branch head, so zero commits landed in between; live re-run 2026-08-20 against a self-hosted instance built from that commit, measured with Playwright's own accessibility computation plus a direct label[for] to getElementById resolution: still reproduces, including the corrected 2-of-15 spinbutton count, the two dangling for= targets and the duplicate DOM id)"
format_note: "Matches .github/ISSUE_TEMPLATE/1-bug-report.yml exactly: every required `### ` header present and non-empty, in template order, with the required Existing-issue checkbox ticked. Dropdown sections carry only real option values, verified against the live template on 2026-08-21 (Product variant = Self-hosted; Area = Resume builder & data). The optional `Template` section is omitted deliberately: this is builder chrome, not template rendering. `blank_issues_enabled: false` on this repo, so the form shape is mandatory. Own sub-headings demoted to ####."
---

# FormControl stamps the label's target id on a non-labelable wrapper, so Slug, Tags and the Sidebar Width slider have no accessible name

### Existing issue

- [x] I searched the existing issues and could not find a matching report.

Keyword searches for screen readers, aria labels and accessible names, plus a sweep of the 800 most recent issues and pull requests, found one open accessibility item and one closed precedent. The open one, https://github.com/AmruthPillai/Reactive-Resume/issues/2844, is about the **rendered resume output** (heading levels, semantic bullets, image alt text), a different surface from the builder's form controls, so this is not a duplicate of it. It is worth noting that its only maintainer comment asks the reporter to narrow the report to a concrete accessibility problem with current behaviour, expected behaviour and acceptance criteria, which is the shape this report already has. The closed https://github.com/AmruthPillai/Reactive-Resume/issues/2298 ("buttons do not have accessible names", v4 marketing homepage) is precedent that reports of this class are accepted here.

### Product variant

Self-hosted

### Reactive Resume version

5.2.7 (commit `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` on `main`, 16 commits after the `v5.2.7` tag, so this exact build is not a release)

### Area

Resume builder & data

### Environment

Chromium 141.0.7390.37 (headless, driven by `playwright-core` 1.62.1, using Playwright's own accessibility computation) on macOS (Darwin 25.5.0, arm64); self-hosted, built from source with `pnpm install --frozen-lockfile` and `pnpm run build`, run as `node apps/server/dist/index.mjs`, PostgreSQL 18 in Docker.

### Summary

`FormLabel` renders an `htmlFor` of the form `<id>-form-item`, and `FormControl` puts that same id on whatever element the render prop's root happens to be. Where the render prop is a **wrapper** rather than the real control, the id lands on an element that a `<label>` cannot name, and the real input inside it is left anonymous.

Measured live, resolving each `label[for]` to the element that actually carries the id:

```
label "Name"          for=_r_3h_-form-item  -> target=INPUT             OK
label "Slug"          for=_r_3j_-form-item  -> target=FIELDSET          BROKEN
label "Tags"          for=_r_3l_-form-item  -> target=DIV               BROKEN
label "Sidebar Width" for=_r_jv_-form-item  -> target=DIV[role=group]   BROKEN
```

A `<label>` can only name a labelable element, so for the three broken rows the visible caption is not attached to anything: the text input inside the Slug fieldset, the chip field behind Tags, and the slider thumb behind Sidebar Width are all anonymous to assistive technology and to any name-based query. In the same dialog `getByLabel('Slug')` and `getByLabel('Tags')` both count **0**, while `getByLabel('Name')` counts 1.

Two corrections to any earlier or broader version of this claim, which we make up front so a maintainer opening the builder does not find them and discount the whole report:

- **Exactly 2 of the 15 builder spinbuttons are anonymous, not 15.** The other 13 are correctly named. The two are Picture -> Size (value `"100"`) and the Sidebar Width numeric input (value `"30"`).
- The pattern is real but not everywhere. Several places that look like instances are correctly nested (`InputGroup` wrapping `FormControl render={<InputGroupInput …>}`) and measure as correctly named.

Our run also reproduced a **second defect family** in the same components, which is smaller but concrete: `FormLabel`s whose `for=` names an id that no element in the document carries at all (Picture -> Size, Basics -> Website), and one duplicate DOM id (`_r_jv_-form-item` appears twice) because one `FormItem` contains two `FormControl`s.

### Steps to reproduce

**A. The Create-a-resume dialog.**

1. Sign in and open the dashboard, then press the control that opens **Create a new resume**.
2. Inspect the accessibility tree, or run the queries below. `Name` resolves; `Slug` and `Tags` do not.

Verbatim from our run, the relevant part of the dialog's accessibility snapshot:

```
- dialog "Create a new resume":
  - text: Name
  - textbox "Name"
  - button "Generate a random name"
  - text: Slug
  - group:
    - group: http://127.0.0.1:54490/guardowner/
    - textbox                       <- anonymous
  - text: Tags
  - textbox "Add keyword"
  - group "Create resume with options":
    - button "Create"
```

```
getByLabel('Name').count()                               1
getByLabel('Slug').count()                               0
getByLabel('Tags').count()                               0
CONTROL getByRole('textbox', {name:'Name', exact:true})  1
getByRole('textbox', {name:'Slug'})                      0

label "Name"  for=_r_3h_-form-item  -> target=INPUT      OK
label "Slug"  for=_r_3j_-form-item  -> target=FIELDSET   BROKEN
label "Tags"  for=_r_3l_-form-item  -> target=DIV        BROKEN
```

**B. The builder sidebar, Layout and Typography sections open.**

3. Open a resume in the builder and expand the right sidebar's Layout, Page and Typography sections.
4. Query the Sidebar Width slider by its visible label. It does not resolve, although exactly one slider exists on the page:

```
getByRole('slider', {name: 'Sidebar Width'})   0
sliders on the page                            1
slider attributes  [{"tag":"INPUT","ariaLabel":null,"ariaLabelledby":null,"id":"base-ui-_r_k3_"}]
```

5. Take the spinbutton census. This is where the corrected count comes from:

```
spinbutton census (name / value):
  spinbutton: (ANONYMOUS): "100"          <- Picture > Size
  spinbutton "Rotation": "0"
  spinbutton "Aspect Ratio": "1"
  spinbutton "Border Radius": "0"
  spinbutton "Border Width": "0"
  spinbutton "Shadow Width": "0"
  spinbutton: (ANONYMOUS): "30"           <- Sidebar Width numeric
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
```

**C. The second family, dangling `for=` targets and a duplicate id.**

6. Resolve every `FormLabel`'s `for=` to `document.getElementById`. Two name ids that nothing in the document carries, and one `FormControl` id is used twice:

```
label "Size"          for=_r_1v_-form-item  -> target=NOTHING          (Picture > Size)
label "Website"       for=_r_2v_-form-item  -> target=NOTHING          (Basics > Website)
label "Sidebar Width" for=_r_jv_-form-item  -> target=DIV[role=group]
label "Font Family"   for=_r_kf_-form-item  -> target=BUTTON[role=combobox]

DOM ids used more than once  [["_r_jv_-form-item", 2]]
```

#### The control, which shows the instrument is fine

On the same two surfaces, correctly wired fields resolve normally: `getByLabel('Name')` = **1** in the dialog, `getByRole('textbox', {name: 'Name', exact: true})` = **1**, and `getByRole('spinbutton', {name: 'Font Size'})` = **2** in the sidebar. So the pages render, the labels exist, and the query method works. It is the specific fields listed above that have no name.

### Expected behavior

Every labelled control should be reachable by its visible label: `getByLabel('Slug')`, `getByLabel('Tags')` and `getByRole('slider', {name: 'Sidebar Width'})` should each resolve to the real input, exactly as `getByLabel('Name')` already does, and a screen reader should announce the field's caption when focus lands on it.

The fix is in the shared component rather than in each call site. `FormControl` should put the `<id>-form-item` id on the labelable element rather than on the render prop's root. Options, in the order we would try them:

1. Have `FormControl` forward the id to the inner control that the wrapper renders (for `InputGroup`, that is `InputGroupInput`; for `Slider`, the `role="slider"` element; for `ChipInput`, its inner text input), so the existing call sites keep working unchanged.
2. Or, where a wrapper genuinely has to carry the association, wire it with `aria-labelledby` pointing at the label's own id instead of `htmlFor`, which does work on a `<fieldset>` or a `div[role=group]`.
3. Separately, guard against the two smaller defects: a `FormLabel` whose `for=` resolves to nothing at all, and two `FormControl`s sharing one `FormItem` and therefore one id.

A development-time assertion would keep this from returning: on mount, `FormControl` can check that the element receiving the id is labelable, and warn when it is not. That turns a silent accessibility regression into something visible in the console the day it is written.

### Actual behavior

The id lands on the wrapper. `Slug` resolves to a `FIELDSET`, `Tags` to a `DIV`, `Sidebar Width` to a `DIV[role=group]`, and the real control inside each has no accessible name. The Sidebar Width slider is an `INPUT` with `aria-label: null` and `aria-labelledby: null`. Two of the builder's fifteen spinbuttons are anonymous. Two `FormLabel`s point at ids no element carries, and one id is present twice in the document.

#### Cause

Read at `3221afda9ddfb03d6cce87927b0ce47338b4cfa8`:

```
packages/ui/src/components/form.tsx:30-42     FormLabel -> <Label htmlFor={`${id}-form-item`} …>   (htmlFor at :38)
packages/ui/src/components/form.tsx:44-61     FormControl -> useRender({ props: { id: `${id}-form-item` } })   (id at :52)
```

https://github.com/AmruthPillai/Reactive-Resume/blob/3221afda9ddfb03d6cce87927b0ce47338b4cfa8/packages/ui/src/components/form.tsx#L30-L61

The wrappers the id lands on, and why a label cannot name them:

```
packages/ui/src/components/input-group.tsx:9-19       InputGroup renders a <fieldset>
packages/ui/src/components/input-group.tsx:117-128    InputGroupInput renders the real <Input>, and is NOT what the id lands on
apps/web/src/components/input/chip-input.tsx:330-331  ChipInput's root is a <div>
packages/ui/src/components/slider.tsx:15-25           Slider's root is SliderPrimitive.Root, not the role="slider" thumb
```

The call sites that produce the three named symptoms:

```
apps/web/src/dialogs/resume/index.tsx:393-395   FormControl render={<InputGroup>}    -> Slug
apps/web/src/dialogs/resume/index.tsx:425-433   FormControl render={<ChipInput …>}   -> Tags
apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/layout/index.tsx:71-84   FormControl render={<Slider …>}
apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/layout/index.tsx:86-88   a SECOND FormControl in the same FormItem  -> the duplicate id
```

A note on the variant dropdown, since it takes only one value: we drove a **self-hosted** build. This is pure client-side rendering with no deployment branch, so the cloud deployment renders the identical markup. Please do not read the dropdown as narrowing this to self-hosted installs.

### Logs and screenshots

No screenshot is needed, and a screenshot would in fact hide the bug: these fields look correctly labelled on screen. The evidence is the label-to-target resolution and the role queries quoted above, both taken from the live document.

The single line that states the whole finding:

```
label "Name" for=_r_3h_-form-item -> target=INPUT      OK
label "Slug" for=_r_3j_-form-item -> target=FIELDSET   BROKEN
label "Tags" for=_r_3l_-form-item -> target=DIV        BROKEN
```

(The `_r_…_` ids are React-generated and will differ per render; the target element types are what matter and are stable.)

#### Suggested labels

`bug`, `status: needs triage` (both applied by the form), plus `v5` and `area: builder`. Our account cannot apply labels itself.

Deliberately **no** deployment label: this is client-side rendering with no deployment branch, so narrowing it to either cloud or self-hosted would be wrong.

Found by TrueCourse running the product's published documentation against a live instance; the full transcript (the accessibility snapshots, every label-to-target resolution and the complete spinbutton census) is available on request.
