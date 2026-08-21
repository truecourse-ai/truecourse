# Independent hand-verification — Reactive-Resume reference corpus

**Date:** 2026-08-21 · **Checkout:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8`
(`git log -1` → `3221afda Sync Translations from Crowdin (#3365)`) ·
**Instance:** a clean one, built for this verification alone and destroyed afterwards.

This is a second, independent pass over the corpus's product-bug and doc-drift
findings. Nothing here was taken on the word of `findings.md` or
`run-classification.md`: every claim was re-driven against a fresh database on a
fresh port, every mechanism `file:line` was re-read at this SHA, and every doc
sentence was re-quoted from the tree. Each finding carries a **probe** (the
minimal reproduction) and a **control** (the thing that must behave differently
if the finding is real).

**Nothing in the product source, the lockfiles or `reference/*.md` was modified.**
The only file this pass writes is the one you are reading.

---

## Cross-reference — corpus scenarios and upstream issues/PRs

Scenario ids and failing steps are from the converged post-item-115 board
(`run-classification.md` §11); upstream states were re-checked read-only on
2026-08-21 (`gh api` / `gh search`, nothing created or commented). **Every
finding is unreported upstream**; the nearest artefacts are noted inline.

| finding | corpus scenario (failing step) | upstream (AmruthPillai/Reactive-Resume) |
| --- | --- | --- |
| **F3** `downloads` has no write path | `the-downloads-metric-counts-a-visitors-pdf.web.1` (6) | **unreported** |
| **F4** views deduped per client per hour | `a-public-visit-is-counted-in-the-statistics.web.1` (11) | **unreported** |
| **F7** `FormControl` id lands on an unlabelable wrapper | 3 reds: `create-a-resume-from-the-dashboard.web.1` (6), `find-the-space-settings-the-guide-points-at.web.1` (13), `rename-a-resume-from-the-resume-menu.web.1` (12) — the last also blocks deliberate red D17 | **unreported** — [#2844](https://github.com/AmruthPillai/Reactive-Resume/issues/2844) (open, "Improved accessibility") is about the rendered resume, a different surface |
| **F8** `Sort by`/`Filter by` comboboxes have no accessible name | `filter-the-dashboard-by-a-tag.web.1` (7), `sort-the-dashboard-from-the-sort-menu.web.1` (5) | **unreported** |
| **F9** `.catch()` silently coerces out-of-bounds values (§3: a class of ~30 sites, not just `template`) | `the-resume-document-refuses-values-outside-the-documented-bounds.api.1` (3) | **unreported** — [#3174](https://github.com/AmruthPillai/Reactive-Resume/issues/3174) (open) is the same family: invalid input silently discards state |
| **F10** missing `@version` is a warning, stylesheet still applies | no board red — `the-custom-styles-editor-refuses-what-semantic-css-does-not-support.web.1` passes only because it was re-authored onto `@version 2;` | **unreported** |
| **D2** format buttons never spinner/disable — the dialog closes | `open-the-download-dialog-and-see-its-four-formats.web.1` (17) | **unreported** (doc-side) |
| **D8** one password field, no Confirm | `put-a-password-in-front-of-the-public-resume.web.1` (16) | **unreported** (doc-side) |
| **D13** Undo disabled after a restore | `restore-an-earlier-version.web.1` (16) | **unreported** (doc-side) |
| **D14** template switch is an ordinary throttled autosave, not a snapshot moment (§10's sharper statement) | `a-template-switch-takes-a-snapshot.web.1` (15) | **unreported** (doc-side) |
| **D24** docs spell `Free-Form`; the app renders `Free-form` | `change-the-page-format.web.1` (14) | **unreported** (doc-side) |
| **D25** Template section shows one preview; the gallery the images live in is undocumented | `switch-the-resume-template-from-the-gallery.web.1` (16) | **unreported** (doc-side) |
| **D26/D27** no `Hidden` switch; clicking a section heading opens nothing | `hide-a-section-and-lay-it-out-in-two-columns.web.1` (14) | **unreported** (doc-side) |

Adjacent open issue, recorded so it is not re-searched:
[#3008](https://github.com/AmruthPillai/Reactive-Resume/issues/3008) (public
page 500 when the name is redacted) — same raw-500 spirit as diagnostic D15, a
different mechanism.

---

## 0. Verdict table

| # | finding | verdict |
| --- | --- | --- |
| 1 | **F3** — `downloads` has no write path | **CONFIRMED** (and stronger than recorded: the visitor's PDF really arrives) |
| 2 | **F4** — a view is deduped per client per hour | **CONFIRMED** |
| 3 | **F7** — `FormControl` stamps its id on an unlabelable wrapper | **CONFIRMED** (two sub-claims of the write-up are wrong — §3.4) |
| 4 | **F8** — the dashboard's `Sort by` / `Filter by` are anonymous | **CONFIRMED** |
| 5 | **F9** — `metadata.template` is `z.enum(…).catch("onyx")` | **CONFIRMED, and broader than recorded** — template is *not* the only hole |
| 6 | **F10** — the missing `@version` line is a warning, not fatal | **CONFIRMED**, both halves, including "the stylesheet still applies" |
| 7 | **D2** — the format buttons never show a spinner | **CONFIRMED** |
| 8 | **D8** — the set-password prompt has one field | **CONFIRMED** |
| 9 | **D13** — Undo is disabled after a restore | **CONFIRMED** |
| 10 | **D14** — a template switch writes no version row | **PARTIAL** — true only when a snapshot < 2 min old already exists |
| 11 | **D24** — `Free-Form` vs `Free-form` | **CONFIRMED** |
| 12 | **D25** — the Template section has no gallery | **CONFIRMED** |
| 13 | **D26/D27** — no `Hidden` switch, the heading opens nothing | **CONFIRMED** (the heading click *collapses* the section) |

---

## 1. Setup

### 1.1 The database

A new compose project, `tcverify-rxresume`, on a port nothing else on this
machine uses. The corpus's own project (`tc-rxresume`, port 54340) was **never
started**, and neither were the containers `database`, `redis` or
`caldiy-calcom-1` (all three were already running when this pass began and were
left exactly as found).

```yaml
name: tcverify-rxresume
services:
  postgres:
    image: postgres:18
    environment: { POSTGRES_DB: postgres, POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres }
    ports: ["127.0.0.1:54440:5432"]
    volumes: [pgdata:/var/lib/postgresql]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres -d postgres"], interval: 3s, timeout: 3s, retries: 20 }
volumes: { pgdata: }
```

One deviation from `reference/seed/compose.yml`, forced by the image: a named
volume mounted at `/var/lib/postgresql/data` makes `postgres:18` refuse to boot
("Counter to that, there appears to be PostgreSQL data in: /var/lib/postgresql/data
(unused mount/volume)"). The mount point must be `/var/lib/postgresql`. The
corpus's file sidesteps this by carrying no volume at all.

### 1.2 The application

No build was needed — `node_modules/`, `apps/server/dist/index.mjs` and
`apps/web/dist/` were already present in the checkout and were reused unchanged.
The server was started exactly per `recipe-notes.md` §2, on port **54490**:

```bash
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54440/postgres' \
AUTH_SECRET='guard-reference-auth-secret' \
FLAG_DISABLE_API_RATE_LIMIT=true \
NODE_ENV=production PORT=54490 SERVER_PORT=54490 APP_URL='http://127.0.0.1:54490' \
node apps/server/dist/index.mjs
```

```json
{"service":"reactive-resume","status":"healthy","database":{"status":"healthy","latencyMs":10},
 "storage":{"type":"local","status":"healthy","message":"Local filesystem storage is accessible and has read/write permission."}}
```

### 1.3 The seed

`node reference/seed/guard-seed.mjs` against the fresh database, first run:

```
[guard-seed] server healthy on http://127.0.0.1:55750
[guard-seed] created account guard-owner@rxresume.test
[guard-seed] e-mail verified
[guard-seed] created resume seed-1 … seed-6, seed-public
[guard-seed] writing the private-note sentinel into seed-public
[guard-seed] publishing seed-public
```

The console-log e-mail-verification technique worked exactly as documented — the
app printed the message with SMTP unset and the seed followed the
`/api/auth/verify-email?token=…` link out of its child's stdout.

### 1.4 Probes

Browser probes used **Playwright's own accessibility computation** —
`getByLabel` / `getByRole({ name })` / `ariaSnapshot()` — driven from
`playwright-core@1.62.1` (headless Chromium). API probes used a cookie-jar
`fetch` client sending `Origin`, the same shape the seed uses. Screenshots were
never needed: every decisive string is inlined below.

---

## 2. Product bugs

### F3 — the `downloads` statistic has no write path · **CONFIRMED**

**Doc quote**, `docs/guides/sharing-your-resume-publicly.mdx:90` (byte-identical
to `reference/spec-docs/guides/sharing-your-resume-publicly.mdx`):

> `| **Downloads**       | Number of times a visitor downloaded your resume as a PDF        |`

**Probe.** The owner (over HTTP) created a resume with sample data and published
it. A browser context signed in to nothing — `cookies: 0` — loaded
`/guardowner/f3-<u>` and pressed the public page's own `Download PDF` button.

```
F3 stats BEFORE any visit:              {"isPublic":true,"views":0,"downloads":0,"lastViewedAt":null,"lastDownloadedAt":null}
F3 visitor loaded public page; cookies: 0
F3 stats AFTER visitor load (control):  {"isPublic":true,"views":1,"downloads":0,"lastViewedAt":"2026-08-20T23:15:11.272Z","lastDownloadedAt":null}
F3 clicked Download PDF; page text now: … Download PDF … Please wait while your PDF is being generated...
F3 browser download event:              download event: resume.pdf
F3 console warnings/errors:             ["warning: Buffer is not defined", ×4]
F3 stats AFTER visitor Download PDF:    {"isPublic":true,"views":1,"downloads":0,"lastViewedAt":"2026-08-20T23:15:11.272Z","lastDownloadedAt":null}
F3 VERDICT downloads / lastDownloadedAt: 0 / null
F3 CONTROL views / lastViewedAt:         1 / "2026-08-20T23:15:11.272Z"
```

**Control.** Same endpoint, same resume, same request: `views` moved `0 → 1` and
`lastViewedAt` went from `null` to a timestamp. `downloads` stayed `0` and
`lastDownloadedAt` stayed `null`. The counter is not merely unmoved by this
download — it has no path by which anything could move it.

**Stronger than the corpus recorded.** `run-classification.md` §3.2 notes the
`Buffer is not defined` warning and says "whether the visitor's file ever arrives
is not observable here". It is observable with `acceptDownloads`, and it does
arrive: **the browser fired a real `download` event for `resume.pdf`**. So the
visitor genuinely received the PDF the doc is counting, and the counter still
read zero. The warning is noise, not a failed export.

**Mechanism, re-read at this SHA:**

- `packages/db/src/schema/resume.ts:77-80` — `views`, `downloads`,
  `lastViewedAt`, `lastDownloadedAt` on `resume_statistics`; `:103-104` — the
  same two counters on `resume_statistics_daily`. ✓ cite accurate.
- `packages/api/src/features/resume/statistics.ts:22` —
  `downloads: z.number().describe("Total number of times the resume has been downloaded.")`
  in the output schema of the `GET /resumes/{id}/statistics` procedure. ✓
- `packages/api/src/features/resume/service.ts:238` —
  `increment: async (input: { id: string; views?: boolean; downloads?: boolean })`,
  whose body (`:239-276`) has working SQL for both counters. ✓
- **The sole call site in the tree**, `service.ts:550`:
  ```ts
  await resumeService.statistics.increment({ id: resume.id, views: true });
  ```
- `grep -rn "statistics\.increment" apps/ packages/` → three hits: `service.ts:550`,
  and two in `service.test.ts` (`:887`, `:895`, also `views: true`). Nothing else.
- `grep -rn "downloads: true" apps/ packages/` → **0 matches**. Repo-wide
  (excluding `node_modules`/`.git`) there are 9 matches and **all nine are corpus
  artefacts** — `reference/*.md`, `.truecourse/scenarios/*`, `guard/interfaces.json`.
  Zero in product source.
- `packages/api/src/features/resume/access-policy.ts:69-77` still carries the
  comment "Owner self-views/**downloads** do not count … Call sites that increment
  `views` / `downloads` should gate on this helper" — a contract with no
  counterparty, exactly as `findings.md` says. ✓

---

### F4 — a view is deduped per client per hour · **CONFIRMED**

**Doc quote**, `docs/guides/sharing-your-resume-publicly.mdx:102`:

> A view is counted each time someone loads your public resume page. This includes:

**Probe.** One browser context loaded the same published resume three times —
a first load, a reload, and a third load with a different query string:

```
F4 stats BEFORE:                             {"views":0,"downloads":0,"lastViewedAt":null,…}
F4 stats after visitor LOAD 1:               {"views":1,…,"lastViewedAt":"2026-08-20T23:15:12.578Z"}
F4 stats after visitor LOAD 2 (same client): {"views":1,…,"lastViewedAt":"2026-08-20T23:15:12.578Z"}
F4 stats after visitor LOAD 3 (same client): {"views":1,…,"lastViewedAt":"2026-08-20T23:15:12.578Z"}
F4 VERDICT views after 3 loads by one client: 1
```

Three loads, one view — and `lastViewedAt` frozen at the first load's timestamp.

**Control — a distinct client does increment.** The dedup key is a
user-agent + accept-language fingerprint when no trusted-proxy header is present,
so "a distinct client" means a distinct fingerprint:

```
F4 CONTROL distinct client UA: TCVerify-DistinctVisitor/1.0 / de-DE
                               (visitor 1 UA head: Mozilla/5.0 (Macintosh; Intel Mac OS X 1…)
F4 CONTROL stats after distinct client load: {"views":2,…,"lastViewedAt":"2026-08-20T23:15:15.339Z"}
F4 CONTROL third client public read status:  200   (user-agent TCVerify-ThirdVisitor/1.0, accept-language fr-FR)
F4 CONTROL stats after third client:         {"views":3,…,"lastViewedAt":"2026-08-20T23:15:15.720Z"}
```

`0 → 1 → 1 → 1 → 2 → 3`. The counter works; it counts *visitors per hour*, not
*loads*.

**Mechanism, re-read at this SHA** — every cite in `findings.md` F4 is accurate:

```
packages/api/src/features/resume/view-dedup.ts:6      const WINDOW_MS = 60 * 60 * 1000; // 1 hour
packages/api/src/features/resume/view-dedup.ts:7      const MAX_ENTRIES = 50_000;
packages/api/src/features/resume/view-dedup.ts:15-27  shouldCountView(key, now) — true at most once per key per window
packages/api/src/features/resume/view-dedup.ts:31-45  clientKeyFromHeaders — `ip:<trusted-proxy-ip>`, else
                                                      `fp:<user-agent 0..64>:<accept-language 0..16>`
packages/api/src/features/resume/service.ts:547-552   the call site:
  if (shouldCountForStatistics(resume, viewer)) {
    const key = `${resume.id}:${clientKeyFromHeaders(input.requestHeaders)}`;
    if (shouldCountView(key, Date.now())) {
      await resumeService.statistics.increment({ id: resume.id, views: true });
    }
  }
```

The `view-dedup.ts:3-5` comment confirms the corpus's two footnotes as well: the
Map is per-process ("for multi-instance, swap the Map for a Redis SETNX+EXPIRE
keyed the same way"), and `MAX_ENTRIES` bounds it with an eviction sweep.

---

### F7 — `FormControl` stamps its id on an unlabelable wrapper · **CONFIRMED**

**Probe — the Create-a-resume dialog.** Playwright's own accessibility tree:

```
- dialog "Create a new resume":
  - text: Name
  - textbox "Name"
  - button "Generate a random name"
  - text: Slug
  - group:
    - group: http://127.0.0.1:54490/guardowner/
    - textbox                       ← anonymous
  - text: Tags
  - textbox "Add keyword"
  - group "Create resume with options":
    - button "Create"
```

```
getByLabel('Name').count()                                 1
getByLabel('Slug').count()                                 0
getByLabel('Tags').count()                                 0
CONTROL getByRole('textbox', {name: 'Name', exact: true})  1
getByRole('textbox', {name: 'Slug'})                       0
```

And the `for=` → target resolution, which is the bug stated in one line:

```
label "Name" for=_r_3a_-form-item -> target=INPUT     ✓
label "Slug" for=_r_3c_-form-item -> target=FIELDSET  ✗
label "Tags" for=_r_3e_-form-item -> target=DIV       ✗
```

**Probe — the Sidebar Width slider** (builder, Layout section):

```
getByRole('slider', {name: 'Sidebar Width'})  0
sliders on the page                           1
slider attributes  [{"tag":"INPUT","ariaLabel":null,"ariaLabelledby":null,"id":"base-ui-_r_8m_"}]
slider accessible names (aria-label)          [""]
label "Sidebar Width" for=_r_8i_-form-item -> target=DIV[role=group]
```

**Control.** On the same pages, correctly wired fields resolve:
`getByLabel('Name')` = 1 in the dialog; `getByRole('textbox', {name: 'Search resumes...'})`
= 1 on the dashboard; `getByRole('spinbutton', {name: 'Font Size'})` = 2 in the
sidebar. The measurement instrument is fine — the three controls above genuinely
have no name.

**Mechanism, re-read at this SHA:**

```
packages/ui/src/components/form.tsx:30-42     FormLabel → <Label htmlFor={`${id}-form-item`} …>   (htmlFor at :38)
packages/ui/src/components/form.tsx:44-61     FormControl → useRender({ render, props: { id: `${id}-form-item`, … } })  (id at :52)
packages/ui/src/components/input-group.tsx:9-19    InputGroup renders a <fieldset>
packages/ui/src/components/input-group.tsx:117-128 InputGroupInput renders the real <Input>, and is NOT what the id lands on
apps/web/src/components/input/chip-input.tsx:330-331  ChipInput's root is a <div>
packages/ui/src/components/slider.tsx:15-25    Slider's root is SliderPrimitive.Root, not the role="slider" thumb
```

The three confirmed call sites of the exact pattern
(`FormControl render={<non-labelable wrapper>}`):

```
apps/web/src/dialogs/resume/index.tsx:393-395            FormControl render={<InputGroup>}   → Slug
apps/web/src/dialogs/resume/index.tsx:425-433            FormControl render={<ChipInput …>}  → Tags
apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/layout/index.tsx:71-84   FormControl render={<Slider …>}
apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/layout/index.tsx:86-88   FormControl render={<InputGroup …>}  (same FormItem)
```

#### 3.4 Two sub-claims in `findings.md` F7 do not hold at this SHA

Reported here, not edited into `findings.md`.

**(a) "fifteen anonymous `spinbutton`s" is wrong — there are fifteen spinbuttons,
of which two are anonymous.** With Layout, Page and Typography all open, the
page's own accessibility tree reads:

```
- spinbutton: "100"                     ← anonymous  (Picture → Size)
- spinbutton "Rotation": "0"
- spinbutton "Aspect Ratio": "1"
- spinbutton "Border Radius": "0"
- spinbutton "Border Width": "0"
- spinbutton "Shadow Width": "0"
- slider: "30"                          ← anonymous  (Sidebar Width slider)
- spinbutton: "30"                      ← anonymous  (Sidebar Width numeric)
- spinbutton "Font Size": "10"
- spinbutton "Line Height": "1.5"
- spinbutton "Font Size": "12"
- spinbutton "Line Height": "1.5"
- spinbutton "Margin (Horizontal)": "16"
- spinbutton "Margin (Vertical)": "16"
- spinbutton "Spacing (Horizontal)": "12"
- spinbutton "Spacing (Vertical)": "8"

total spinbuttons                                    15
spinbuttons with NO accessible name                   2
getByRole('spinbutton', {name: 'Font Size'})          2   ← CONTROL: correctly named
getByRole('spinbutton', {name: 'Size', exact: true})  0
```

**(b) three of the five cited "every `FormControl render={<InputGroup …>}`"
call sites are not instances of the bug.** Read at this SHA:

| cite in `findings.md` F7 | what is actually there |
| --- | --- |
| `typography.tsx:155` | `<InputGroup>` wrapping `<FormControl render={<InputGroupInput …>}>` — the **correct** nesting. Measured: `label "Font Size" for=_r_9a_-form-item -> target=INPUT`. |
| `typography.tsx:189` | same inverted-and-correct shape for Line Height. Measured: `-> target=INPUT`. |
| `dialogs/api-key/create.tsx:224` | a bare `<InputGroup>` with no `FormControl` and no `FormLabel` above it — a read-only key display. |
| `dialogs/resume/sections/profile.tsx:190` | a bare `<InputGroup>` under a `FormLabel`, with **no `FormControl` at all**. |

The last one is still a bug, but a *different* one, and this pass found a second
family of it: a `FormLabel` whose `for=` names an id **no element in the document
carries**. Measured live:

```
label "Size"    for=_r_1v_-form-item -> target=NOTHING     (Picture → Size)
label "Website" for=_r_2v_-form-item -> target=NOTHING     (Basics → Website)
```

A third, smaller consequence, also measured live: the Layout section puts **two**
`FormControl`s inside one `FormItem` (`layout/index.tsx:71` and `:86`), so both
receive the same id and the document carries a duplicate:

```
DOM ids used more than once  [["_r_jv_-form-item", 2]]
```

**Net:** F7's headline — Slug, Tags and the Sidebar Width slider have no
accessible name because the id lands on a `<fieldset>`, a `<div>` and a slider
root — is exactly right and reproduces to the character. Its supporting counts
and its call-site list are not.

---

### F8 — the dashboard's `Sort by` and `Filter by` are anonymous · **CONFIRMED**

**Probe.** Playwright's aria snapshot of the live dashboard control strip:

```
- separator
- text: Sort by
- combobox:
  - text: Last Updated
- text: Filter by
- combobox:
  - text: Filter by
- textbox "Search resumes..."
```

```
combobox count on dashboard                       2
getByRole('combobox', {name: /sort/i})            0
getByRole('combobox', {name: /filter/i})          0
getByRole('combobox', {name: 'Last Updated'})     0
getByLabel('Sort by')                             0
getByLabel('Filter by')                           0

combobox attributes:
 [{"tag":"BUTTON","ariaLabel":null,"ariaLabelledby":null,"id":"base-ui-_r_i_","text":"Last Updated"},
  {"tag":"BUTTON","ariaLabel":null,"ariaLabelledby":null,"id":"base-ui-_r_l_","text":"Filter by"}]

every <label> on the dashboard:
 [{"text":"Sort by","htmlFor":null},{"text":"Filter by","htmlFor":null}]
```

Both comboboxes exist; neither can be addressed by name; and the two visible
labels carry no `for` at all, so they are decorative text.

**Control.** The search field on the same strip *is* addressable:
`getByRole('textbox', { name: 'Search resumes...' })` → **1**.

**Mechanism**, `apps/web/src/routes/dashboard/resumes/index.tsx:106-136` — the
cite is exact:

```tsx
<Label className="text-muted-foreground text-xs sm:text-sm">     // :106
  <Trans>Sort by</Trans>
</Label>
<Combobox className="w-full sm:w-44" value={sort} options={sortOptions}
          placeholder={t`Sort by`} … />                          // :109-118
…
<Label …><Trans>Filter by</Trans></Label>                        // :124-126
<Combobox multiple … placeholder={t`Filter by`} … />             // :127-136
```

No `FormItem`, so no `htmlFor` is attempted; no `aria-label`, no
`aria-labelledby`; and `combobox` takes no name from its contents.

---

### F9 — an out-of-enum `metadata.template` is silently rewritten · **CONFIRMED, and broader than recorded**

**Doc quote**, `docs/guides/json-resume-schema.mdx:3297-3318` — `metadata.template`
is published as a JSON-Schema `"enum"` of exactly fifteen names, `"default": "onyx"`.

**Probe.** The template was first moved off its default so the rewrite is visible:

```
set template=chikorita ->                       200 stored=chikorita
PROBE template="tcverify-no-such-template" ->   200 stored=onyx
  response body carried any diagnostic?         no
```

A resume created `withSampleData` (template `azurill`) shows the same silent
overwrite: `PATCH … "/metadata/template" = "tcverify-no-such-template"` → **200**,
`data.metadata.template` reads back **`"onyx"`**, and the 200 body contains no
error, warning or message of any kind.

**Control 1 — an in-enum value persists.** `template=chikorita` → 200, stored
`chikorita`. So the write path works; it is the *validation* that is missing.

**Control 2 — a bound with no `.catch()` really is a 400, and preserves state.**

```
CONTROL set page.gapX=7  -> 200 stored=7
CONTROL page.gapX=-5     -> 400 stored=7
CONTROL 400 body: {"defined":true,"code":"INVALID_PATCH_OPERATIONS","status":400,
                   "message":"Patch produced invalid resume data: [{ \"origin\": \"number\",
                   \"code\": \"too_small\", \"minimum\": 0, …"}
```

**Mechanism**, `packages/schema/src/resume/data.ts:627-630` — cite exact:

```ts
export const metadataSchema = z.object({
	template: templateSchema
		.catch("onyx")
		.describe("The template to use for the resume. Determines the overall design and appearance of the resume."),
```

`templateSchema` is the fifteen-name `z.enum` at
`packages/schema/src/templates.ts:3-18`. `.catch()` swallows the parse failure
before `parseWritableResumeData`
(`packages/api/src/features/resume/resume-data-validation.ts:23-24`, reached from
`service.ts:162`) can turn it into a 400. All cites verified.

#### The correction: `findings.md` F9's "template is the hole" is false at this SHA

`findings.md` F9 says "Every other documented bound in the same document IS
enforced; template is the hole." It is not the only hole. Driving *every* bound
the corpus scenario
`the-resume-document-refuses-values-outside-the-documented-bounds.api.1` asserts —
the scenario aborts at its step 3, so steps 4 and 5 have never actually run:

```
path                                   op       status  stored-after
/metadata/template                     replace  200     silently rewritten
/metadata/page/format                  replace  200     silently rewritten
/metadata/page/marginX                 replace  200     silently rewritten
/metadata/page/gapX                    replace  400     unchanged
/picture/size                          replace  400     unchanged
/picture/rotation                      replace  400     unchanged
/picture/aspectRatio                   replace  400     unchanged
/picture/borderRadius                  replace  400     unchanged
/metadata/design/level/type            replace  400     unchanged
/metadata/stylesheet/mode              replace  400     unchanged
/metadata/typography/body/fontFamily   remove   400     unchanged
/basics                                remove   400     unchanged
/metadata/typography                   remove   400     unchanged
/picture/shadowWidth                   remove   400     unchanged
/basics/email                          remove   400     unchanged
```

The three 200s, each shown as a real silent rewrite off a non-default value:

```
set page.format=letter            -> 200 stored=letter
PROBE page.format="a3"            -> 200 stored=a4      ← doc enum is [a4, letter, free-form]
set page.marginX=40               -> 200 stored=40
PROBE page.marginX=500            -> 200 stored=14      ← doc says minimum 0, maximum 100
set typography.body.fontSize=20   -> 200 stored=20
PROBE typography.body.fontSize=999-> 200 stored=11      ← silently reset to the default
```

`grep -n '\.catch(' packages/schema/src/resume/data.ts` finds **30** of them,
including `marginX` (`:457`), `marginY` (`:458`), `format` (`:462`), `locale`
(`:466`), the three page booleans (`:467`, `:468`, `:472`), `fontSize` (`:417`),
`lineHeight` (`:422`) and `template` (`:629`). So the shape F9 describes —
"a client that typos a value gets a 200 and a resume silently changed underneath
it" — is a **class** of bug spanning at least five documented bounds, not a
one-field oversight. The two corpus scenario steps that would have caught the
other two (`page/format` → a3, `page/marginX` → 500) have simply never executed.

One thing F9 gets right that is worth restating: `/basics/email` accepting
`"not-an-email-address"` with a 200 is **not** a bug — `basicsSchema.email` is
`z.string()` (`data.ts:89`), with no format constraint, and the doc publishes it
as a plain string.

---

### F10 — the missing `@version` line is a warning, and the stylesheet still applies · **CONFIRMED**

**Doc quotes**, `docs/applying-custom-styles.mdx`:

> `:46` — "The first line tells Reactive Resume which language version the stylesheet uses. Keep `@version 1;` at the start of every stylesheet."
>
> `:305-307` — "A fatal version or resource-limit error ignores the whole stylesheet and renders the resume with its base styles until you fix the source."

**Probe — omit the line.** Typed into the builder's Custom Styles editor
(`textbox "Semantic CSS stylesheet"`). The section reported, verbatim:

```
| 1
| 2
| section { margin: 0pt; }
|
| Valid with warnings
|
| Version-one stylesheets should start with @version 1;
|
| Line 1, column 1
```

Not "Fatal error". Not ignored.

**Control 1 — `@version 2;` (a genuinely fatal code) is fatal:**

```
| @version 2;
| section { margin: 0pt; }
|
| Fatal error
| Stylesheet has fatal errors
| Preview and export fall back to base styles.
|
| @version must match the stylesheet language version.
|
| Line 1, column 1
```

**Control 2 — `@version 1;` exactly as prescribed** → the status is a bare
`Valid`, with no warning line. So the editor distinguishes all three states and
puts the omission in the middle one.

**The second half — "and the stylesheet still applies" — proved by export.**
Four PDF exports of the same resume through the builder's own Download PDF, with
only the stylesheet changed between them. The rule is the doc's own example
(`section[type="experience"] > section-heading { color: #0f766e; text-transform: uppercase; }`):

| # | stylesheet | exported PDF size |
| --- | --- | ---: |
| C | none at all | **238 747 bytes** |
| A | the rule, **no `@version` line** | **238 691 bytes** |
| B | the rule under `@version 2;` (fatal) | **238 747 bytes** |
| D | the rule under `@version 1;` (prescribed) | **238 691 bytes** |

**A == D** and **B == C**, to the byte. The versionless stylesheet renders
identically to the doc-prescribed form; the fatal one renders identically to
having no stylesheet at all. (The SHA-256s all differ — a PDF carries a creation
timestamp — which is why the byte length is the signal.)

**Mechanism, re-read at this SHA:**

```
packages/resume/src/stylesheet/compile.ts:45-49
  if (versionDirectives.length === 0 && source.languageVersion === 1) {
    diagnostics.push(
      createDiagnostic("MISSING_VERSION_DIRECTIVE", "warning", "Version-one stylesheets should start with @version 1;"),
    );
  }

packages/resume/src/stylesheet/diagnostics.ts:125-131
  const FATAL_DIAGNOSTIC_CODES = new Set<string>([
    "DUPLICATE_VERSION_DIRECTIVE", "INVALID_VERSION", "RESOURCE_LIMIT",
    "UNSUPPORTED_VERSION", "VERSION_MISMATCH",
  ]);

packages/pdf/src/semantic/resolve.ts:126-133
  if (resolved.diagnostics.some(isFatalStylesheetDiagnostic)) {
    return { presentation: EMPTY_PRESENTATION, sourceTree, renderTree: sourceTree, … };
  }
```

`MISSING_VERSION_DIRECTIVE` is not in the fatal set, so `resolve.ts` never drops
to `EMPTY_PRESENTATION` — which is exactly what the byte counts show.

**Stale cite:** `findings.md` gives `compile.ts:44-48`; at this SHA the block is
`:45-49`. `diagnostics.ts:125-131` is exact.

---

## 3. Doc-drift deliberate reds

### D2 — the download dialog closes before the export starts · **CONFIRMED**

**Doc quote**, `docs/guides/exporting-your-resume.mdx:38`:

> While an export is running, the trigger button and format buttons show a spinner and stay disabled until the file is ready.

**Probe.** The dialog opened by `button "Download options"` really does carry four
format rows:

```
- heading "PDF"      … - button "Download PDF"
- heading "DOCX"     … - button "Download DOCX"
- heading "Markdown" … - button "Download Markdown"
- heading "JSON"     … - button "Download JSON"

BEFORE  button "Download PDF"      present / disabled : 1 / false
BEFORE  button "Download DOCX"     present / disabled : 1 / false
BEFORE  button "Download Markdown" present / disabled : 1 / false
BEFORE  button "Download JSON"     present / disabled : 1 / false
```

`Download PDF` was then pressed and the page polled every ~50 ms:

```
t(ms) | dialog | "Download DOCX" present | its disabled state | spinner text
  243 | open   | yes | false | false
  297 | open   | yes | false | false
  350 | open   | yes | false | false
  403 | GONE   | no  | null  | false
  455 | GONE   | no  | null  | false
  …
  822 | GONE   | no  | null  | false
download arrived at t=823 ms — d2b-….pdf
dialog present when the file arrived: 0
```

The format buttons are **never** disabled and never carry a spinner: for the
~350 ms they survive (the dialog's exit animation) they read `disabled: false`,
and by 403 ms there is no format button on the page at all. The file lands at
823 ms — 420 ms after the last moment anything could have shown a state.

**Control.** Before the press, all four buttons exist and are enabled — so the
probe is measuring a real disappearance, not a missing dialog.

**Mechanism**, `apps/web/src/features/resume/export/download-dialog.tsx:77-80`:

```tsx
const run = (action: () => void | Promise<void>) => {
	setOpen(false);
	void action();
};
```

The dialog is closed *before* the export is even invoked. The
`disabled={isExporting}` props the doc describes are real
(`:141`, `:159`, `:178`, `:196`) and structurally unobservable — their component
is unmounted by the time `isExporting` could be true.

---

### D8 — the set-password prompt has one field · **CONFIRMED**

**Doc quote**, `docs/guides/sharing-your-resume-publicly.mdx:134`:

> Type a password (6-64 characters) and confirm. This password will be required to view your resume.

**Probe.** Sharing section → `Allow Public Access` → `Set Password`. The whole
prompt, verbatim from Playwright's accessibility tree:

```
- alertdialog "Protect your resume from unauthorized access with a password":
  - heading "Protect your resume from unauthorized access with a password" [level=2]
  - paragraph: Anyone visiting the resume's public URL must enter this password to access it.
  - textbox
  - button "Cancel"
  - button "Set Password"
```

```
password inputs in the prompt              1
ALL inputs in the prompt                   1
inputs on the whole page: 45 before -> 46 after   (exactly one new field)
page text contains "Confirm Password"      false
page text contains "Confirm"               false
getByLabel('Confirm Password').count()     0
page text contains "6-64"                  false
```

One field. No second field. The word "Confirm" does not appear anywhere on the
page, and neither does the character range the doc quotes.

**Control.** The prompt did open and did render a `type="password"` input, so the
absence is of the *confirm* field specifically, not of the prompt.

**Bonus, F7 family:** that single password field is itself anonymous —
`[{"type":"password","placeholder":"","ariaLabel":null,"label":null}]`.

---

### D13 — Undo is disabled after a restore · **CONFIRMED**

**Doc quote**, `docs/guides/undoing-changes-and-version-history.mdx:79`:

> - if you change your mind, you can restore the pre-restore version, or press `Cmd/Ctrl+Z` to undo the restore.

**Control first — Undo *is* enabled after an ordinary edit:**

```
BASELINE Undo disabled on a freshly opened builder?   true
CONTROL  page shows "Saved"                           true
CONTROL  Undo disabled after an ordinary edit?        false   ← enabled
CONTROL  stored headline                              dh-…-v2
```

**Probe — restore the earlier snapshot:**

```
version menu rows                                     ["AI edit\nnow"]
a Confirm control stands between the row and the resume  1
PROBE restored headline is on the page                true
PROBE stored headline after the restore               dh-…-v1
PROBE Undo disabled AFTER the restore?                true    ← disabled
PROBE headline after pressing Cmd/Ctrl+Z              dh-…-v1  (unchanged — the keystroke is a no-op)
versions endpoint                                     ["Restored version","Before restore","AI edit"]
```

The restore clears the undo stack. Pressing `Cmd/Ctrl+Z` (both modifiers were
sent) does nothing at all — the headline stays at the restored `v1`. The doc's
other sentence in the same bullet *is* honoured: `Before restore` is a real row
and the pre-restore state is restorable like any other, which is what makes the
red about the `Cmd/Ctrl+Z` half specifically.

---

### D14 — "when you switch templates" among the automatic-snapshot moments · **PARTIAL**

**Doc quote**, `docs/guides/undoing-changes-and-version-history.mdx:44-47`:

> Reactive Resume automatically snapshots your resume at key moments:
> …
> - when you switch templates;

and `:57`:

> The menu lists recent snapshots newest first, each with a label describing what triggered it and a relative timestamp such as *2 hours ago*.

**Probe A — a resume that already carries a snapshot (the corpus's situation):**

```
A versions before the switch              ["AI edit"]
A template after the switch               bronzor      (the switch really happened)
A page shows "Saved"                      true
A versions AFTER the template switch      ["AI edit"]  ← no new row
A CONTROL versions after a checkpointing write  ["AI edit","AI edit"]
```

Confirmed exactly as the corpus records it: the switch persists, the builder says
`Saved`, and the version list does not grow. The control — an explicit
checkpointing write — does add a row on the same resume seconds later, so the
list is not simply frozen.

**Probe B — a virgin resume with no snapshot at all:**

```
B versions before any switch              []
B versions after SWITCH 1                 ["Manual save"]   ← a row DID appear
B template after SWITCH 2                 chikorita
B versions after SWITCH 2 (seconds later) ["Manual save"]   ← no second row
B versions after SWITCH 3                 ["Manual save"]   ← still none
```

**Why PARTIAL.** The corpus's phrasing — "a template switch writes NO new version
row (the save is throttled out of snapshotting)" — is true of the state the
corpus scenario is in, and false in general. A template switch goes down the
ordinary save path and snapshots **iff** no snapshot exists newer than two
minutes:

```
packages/api/src/features/resume/service.ts:67-69
  // Manual-save milestones are debounced server-side: an autosave only checkpoints if the newest
  // snapshot is older than this. Explicit milestones (import, AI edit, restore) always checkpoint.
  const SNAPSHOT_THROTTLE_MS = 2 * 60 * 1000;

packages/api/src/features/resume/service.ts:107
  if (latest && Date.now() - latest.createdAt.getTime() < SNAPSHOT_THROTTLE_MS) return;

packages/api/src/features/resume/service.ts:669-678
  // Debounced manual-save milestone: only snapshots data edits, and only when the previous
  // snapshot is old enough (see SNAPSHOT_THROTTLE_MS). Covers template switches and typing.
  if (input.data !== undefined && !input.skipAutoSnapshot) {
    await maybeSnapshotOnSave({ resumeId: resume.id, userId: input.userId, data: resume.data, label: "Manual save" });
  }
```

The comment at `:670` is explicit — the throttle "covers template switches and
typing". So the drift the doc actually has is two-fold, and sharper than
"switches never snapshot":

1. A template switch is **not a key moment**; it is an ordinary autosave subject
   to a two-minute debounce, so whether it snapshots depends on the clock.
2. When it does snapshot, the row is labelled **`Manual save`** — never anything
   naming a template. `:57`'s "a label describing what triggered it" is not
   honoured for this trigger.

The corpus red is real and its *actual* is right; its stated mechanism needs the
"iff the last snapshot is older than two minutes" qualifier.

---

### D24 — `Free-Form` vs `Free-form` · **CONFIRMED**

**Doc quotes** — the docs use the capital-F spelling throughout, e.g.
`docs/guides/selecting-page-format.mdx:6`:

> Reactive Resume offers three page format options: **A4**, **Letter**, and **Free-Form**.

and `:80`:

> Find the **Format** dropdown and select your preferred option: A4, Letter, or Free-Form.

(also `selecting-page-format.mdx:32,34,46,101,102,104,108,129` and
`fitting-content-on-a-page.mdx:25,27,29,36,39,137`.)

**Probe.** The Page section's Format combobox, opened live:

```
format combobox trigger text                     A4
the three rendered options (verbatim)            ["A4","Letter","Free-form"]
page text contains "Free-Form" (doc spelling)    false
page text contains "Free-form" (rendered)        true
```

Both strings, side by side: docs `Free-Form`, product `Free-form`. The other two
options match the docs exactly, which is what makes this a claim about the
spelling and not about the control.

---

### D25 — the Template section has no gallery · **CONFIRMED**

**Doc quotes**, `docs/guides/choosing-a-template.mdx`:

> `:27` — In the right sidebar, find and click on the **Template** section to expand it.
>
> `:36` — Browse through the available templates and click on the one you want to use. Your resume will instantly update to reflect the new design.

**Probe — the Template SECTION**, `#sidebar-template`, verbatim:

```
- heading "Toggle Template section" [level=3]
- heading "Template" [level=2]
- region "Toggle Template section":
  - button "Azurill":
    - img "Azurill"
    - img
  - heading "Azurill" [level=3]
  - paragraph: Two-column with a bold colored sidebar and skill bars; great for creative or tech roles where visual flair is welcome.
  - text: Two-column Creative Tech Visual flair
```

```
imgs in the Template SECTION                    4  (only one named: "Azurill", the CURRENT template)
section: getByRole('img', {name: 'Chikorita'})  0
section text mentions "gallery"                 no
whole page, imgs named Chikorita (gallery closed) 0
```

There is exactly one preview — the template already in use — one heading, one
description and four tag chips. Nothing to browse.

**Control — the gallery is real, and it is a modal.** Clicking that single
preview (its accessible name is the current template's, `Azurill`) opens:

```
dialog heading                                  Template Gallery
CONTROL inside the gallery: img 'Chikorita'     1
every named img in the gallery                  ["Azurill","Bronzor","Chikorita","Ditgar","Ditto","Gengar",
                                                 "Glalie","Kakuna","Lapras","Leafish","Meowth","Onyx",
                                                 "Pikachu","Rhyhorn","Scizor"]
page text says "Template Gallery"               true
```

All fifteen templates exist — inside a dialog the guide never mentions, reached
by clicking a control the guide never mentions.

**Mechanism**,
`apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/template.tsx:26-44`:
the section renders one `Button` whose `onClick` is
`openDialog("resume.template.gallery")` and whose only content is
`<img src={metadata.imageUrl} alt={metadata.name} />` for the **current**
template. There is no list, no grid and no other trigger in the section.

---

### D26/D27 — no `Hidden` switch, and the heading opens nothing · **CONFIRMED**

**Doc quotes**, `docs/guides/fitting-content-on-a-page.mdx`:

> `:58` — In the left sidebar, find the section you want to adjust, click on the section heading (not an item), and change the **Columns** setting.
>
> `:129` — To hide a section, click on the section heading in the left sidebar and toggle the **Hidden** switch.

**Probe.** The `Experience` section, `#sidebar-experience`, before the click:

```
- heading "Toggle Experience section" [level=3]
- button "Pick an icon"
- heading "Experience" [level=2]
- button "Section options"
- region "Toggle Experience section":
  - list: - listitem: - button "Cascade Studios Senior Game Developer" - button "Options for Cascade Studios"
  - button "Add a new experience"

BEFORE — switches on the page                    8
BEFORE — switch names                            ["","","","","","","",""]
BEFORE — getByRole('switch', {name: 'Hidden'})   0
BEFORE — page text contains "Hidden"             false
```

Then `heading "Experience"` was clicked, exactly as the guide instructs:

```
AFTER — switches on the page                     8      (unchanged)
AFTER — getByRole('switch', {name: 'Hidden'})    0
AFTER — dialogs opened / menus opened            0 / 0
AFTER — lines that APPEARED on the page          []
AFTER — lines that DISAPPEARED                   ["Cascade Studios","Senior Game Developer","Add a new experience"]
```

Clicking the heading opens nothing. It does the opposite of what the guide
promises: it **collapses** the accordion, removing the section's own content from
the page. No `Hidden` switch exists anywhere in the document, before or after.

**Control — the real path works.** From the same section:

```
Section options buttons inside the Experience section   1
menu items                                              ["Add a new item","Hide","Rename","Columns","Reset"]
column radios                                           ["1 Column","2 Columns","3 Columns","4 Columns","5 Columns","6 Columns"]
stored experience.columns after the real path           2
stored experience.hidden                                false
```

`Section options` → `Columns` → `2 Columns` persists as
`data.sections.experience.columns = 2`. And the hide affordance the doc is
reaching for does exist — as a **menu item named `Hide`** in that same menu, not
as a switch named `Hidden`. The `hidden` property is real in the data model
(`'hidden' in sections.experience` → `true`); only the control the doc describes
is fiction.

---

## 4. Stale or wrong cites found while verifying

Reported, not edited. Everything not listed here was checked and is accurate.

| where | cite | at this SHA |
| --- | --- | --- |
| `findings.md` F7 | `packages/ui/src/components/form.tsx:29-59` | `FormLabel` is `:30-42` (`htmlFor` at `:38`), `FormControl` is `:44-61` (`id` at `:52`) |
| `findings.md` F7 | "the typography controls (`…/typography.tsx:155,189`)" listed as instances | **not instances** — those lines are `<InputGroup><FormControl render={<InputGroupInput …>}>`, the correct nesting, and they measure as correctly named live |
| `findings.md` F7 | "the profile dialog's URL (`dialogs/resume/sections/profile.tsx:190`)", "the API-key dialog (`dialogs/api-key/create.tsx:224`)" | bare `<InputGroup>`s with no `FormControl` — a related but different defect (`:190`), and no defect at all (`:224`, a read-only display) |
| `findings.md` F7 | "the fifteen numeric fields beside it are likewise anonymous `spinbutton`s" | 15 spinbuttons exist; **2** are anonymous, 13 are correctly named |
| `findings.md` F9 | "Every other documented bound in the same document IS enforced; template is the hole." | `page.format`, `page.marginX/marginY` and the typography `fontSize`/`lineHeight` bounds are equally unenforced — see §F9 |
| `findings.md` F10 | `packages/resume/src/stylesheet/compile.ts:44-48` | the block is `:45-49` |
| `run-classification.md` §11.1 (D14) | "a template switch writes NO new version row (the save is throttled out of snapshotting)" | true only when a snapshot < 2 min old already exists; on a virgin resume the switch writes one, labelled `Manual save` |
| `run-classification.md` §3.2 (F3) | "whether the visitor's file ever arrives is not observable here" | it is, and it does — a real `download` event for `resume.pdf` fired |

---

## 5. Teardown

Everything created for this verification, and its disposal:

| created | disposed |
| --- | --- |
| compose project `tcverify-rxresume` (network `tcverify-rxresume_default`, volume `tcverify-rxresume_pgdata`, container `tcverify-rxresume-postgres-1`) on `127.0.0.1:54440` | `docker compose -p tcverify-rxresume down -v` — container, network and volume all removed; the project no longer appears in `docker compose ls -a` |
| one `node apps/server/dist/index.mjs` on port `54490` | killed; `lsof -i :54490` and `lsof -i :54440` both silent, `ps` shows no surviving node process from this pass |
| headless Chromium processes (playwright-core) | all closed with their browsers; none survive |
| rows in the fresh database (the seeded account, seven seed resumes, ~15 probe resumes) | gone with the volume |
| scratch scripts and outputs under `…/scratchpad/rxresume-verify/` | deleted — this report stands alone |

Confirmed not touched: compose project **`tc-rxresume` was never started** (it
was `exited(1)` before this pass and is `exited(1)` after), and the containers
`database`, `redis` and `caldiy-calcom-1` were running before and are running
after, untouched.

`git status` in the checkout shows no modification to product source, to
`pnpm-lock.yaml`, or to any `reference/*.md` — the single addition is this file.
