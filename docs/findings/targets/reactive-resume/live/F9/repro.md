# F9 — documented resume bounds are silently coerced instead of rejected

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


**Doc quote**, `docs/guides/json-resume-schema.mdx:3297-3318` — `metadata.template` is published as a
JSON-Schema `"enum"` of exactly fifteen names with `"default": "onyx"`; `page.format` as an enum of three;
`page.marginX` as `0..100`; `typography.*.fontSize` with its own range.

## The `.catch(` count — measured, not quoted

```
$ grep -c '\.catch(' packages/schema/src/resume/data.ts
34
$ grep -o '\.catch(' packages/schema/src/resume/data.ts | wc -l
34
$ grep -n '\.catch(' packages/schema/src/resume/data.ts | wc -l
34
```

**34**, on 34 distinct lines — confirming the re-verify and **not** the 30 the hand-verification report
states. Since `origin/main` head *is* the tested commit, the file cannot have changed; 30 was simply an
undercount. A filer should say "more than thirty coercion sites, of which at least four sit on bounds
the published JSON schema advertises" rather than quote a number a maintainer will recount.

The four that matter sit at `fontSize` `:417`, `lineHeight` `:422`, `marginX` `:457`, `marginY` `:458`,
`format` `:462` and `template` `:629`.

## Probe — every bound driven, each moved OFF its default first

Moving the field off its default before the probe is what proves a **rewrite** rather than a no-op.

```
=== F9 · PROBES: four documented bounds, each moved OFF its default first ===

set  /metadata/template = "chikorita"                 -> 200  stored="chikorita"
PROBE /metadata/template = "tcverify-no-such-template" -> 200  stored="onyx"
      response body carried any diagnostic?           no
      full 200 body: {"id":"01a02256-3989-76db-a9f3-1db04ca8224b","name":"f9-82471292","slug":"f9-82471292","tags":[],"isPublic":false,"isLocked":false,"data":{"picture":{"hidden":false,"url":"/photos/sample-picture.jpg",

set  /metadata/page/format = "letter"                 -> 200  stored="letter"
PROBE /metadata/page/format = "a3"                    -> 200  stored="a4"   (doc enum: a4, letter, free-form)

set  /metadata/page/marginX = 40                      -> 200  stored=40
PROBE /metadata/page/marginX = 500                    -> 200  stored=14   (doc: min 0, max 100)

set  /metadata/typography/body/fontSize = 20          -> 200  stored=20
PROBE /metadata/typography/body/fontSize = 999        -> 200  stored=11   (doc: min 6, max 24)

=== F9 · CONTROL 1: an in-enum value persists (the write path works) ===
CONTROL /metadata/template = "bronzor"                -> 200  stored="bronzor"

=== F9 · CONTROL 2: bounds WITHOUT a .catch() 400 correctly and preserve state ===
set  /metadata/page/gapX = 7                          -> 200  stored=7
CONTROL /metadata/page/gapX = -5                      -> 400  stored=7  <- unchanged
CONTROL 400 body: {"defined":true,"code":"INVALID_PATCH_OPERATIONS","status":400,"message":"Patch produced invalid resume data: [\n  {\n    \"origin\": \"number\",\n    \"code\": \"too_small\",\n    \"minimum\": 0,\n    \"inclusive\": true,\n    \"path\": [\n      \"metadata\",\n      \"page\",\n      \"gapX\"\n    ],\n    \"message\": 

=== F9 · the full 15-bound sweep the corpus scenario asserts ===
/metadata/template                     replace  200  before="bronzor"    after="onyx"       200 SILENTLY REWRITTEN
/metadata/page/format                  replace  200  before="a4"         after="a4"         200 no-op
/metadata/page/marginX                 replace  200  before=14           after=14           200 no-op
/metadata/page/gapX                    replace  400  before=7            after=7            400 unchanged
/picture/size                          replace  400  before=100          after=100          400 unchanged
/picture/rotation                      replace  400  before=0            after=0            400 unchanged
/picture/aspectRatio                   replace  400  before=1            after=1            400 unchanged
/picture/borderRadius                  replace  400  before=0            after=0            400 unchanged
/metadata/design/level/type            replace  400  before="icon"       after="icon"       400 unchanged
/metadata/stylesheet/mode              replace  400  before="semantic"   after="semantic"   400 unchanged
/metadata/typography/body/fontFamily   remove   400  before="IBM Plex Serif" after="IBM Plex Serif" 400 unchanged
/basics                                remove   400  before={"name":"f9-82471292","headline":"Game Developer | Unity & Unreal Engine Specialist","email":"david.kowalski@email.com","phone":"+1 (555) 291-4756","location":"Seattle, WA","website":{"url":"https://davidkowalski.games","label":"davidkowalski.games"},"customFields":[{"id":"019bef5a-0477-77e0-968b-5d0e2ecb34e3","icon":"github-logo","text":"github.com/dkowalski-dev","link":"https://github.com/dkowalski-dev"},{"id":"019bef5a-93e4-7746-ad39-3a132360f823","icon":"game-controller","text":"itch.io/dkowalski","link":"https://itch.io/dkowalski"}]} after={"name":"f9-82471292","headline":"Game Developer | Unity & Unreal Engine Specialist","email":"david.kowalski@email.com","phone":"+1 (555) 291-4756","location":"Seattle, WA","website":{"url":"https://davidkowalski.games","label":"davidkowalski.games"},"customFields":[{"id":"019bef5a-0477-77e0-968b-5d0e2ecb34e3","icon":"github-logo","text":"github.com/dkowalski-dev","link":"https://github.com/dkowalski-dev"},{"id":"019bef5a-93e4-7746-ad39-3a132360f823","icon":"game-controller","text":"itch.io/dkowalski","link":"https://itch.io/dkowalski"}]} 400 unchanged
/metadata/typography                   remove   400  before={"body":{"fontFamily":"IBM Plex Serif","fontWeights":["400","600"],"fontSize":11,"lineHeight":1.5},"heading":{"fontFamily":"Fira Sans Condensed","fontWeights":["500"],"fontSize":12,"lineHeight":1.5}} after={"body":{"fontFamily":"IBM Plex Serif","fontWeights":["400","600"],"fontSize":11,"lineHeight":1.5},"heading":{"fontFamily":"Fira Sans Condensed","fontWeights":["500"],"fontSize":12,"lineHeight":1.5}} 400 unchanged
/picture/shadowWidth                   remove   400  before=0            after=0            400 unchanged
/basics/email                          remove   400  before="david.kowalski@email.com" after="david.kowalski@email.com" 400 unchanged

200s: 3   4xx: 12   (of 15 bounds driven)

=== F9 · the non-bug the report flags: /basics/email is a plain z.string() ===
/basics/email = "not-an-email-address"                -> 200  stored="not-an-email-address"  (data.ts:89 is z.string(); the doc publishes a plain string -> NOT a bug)
```

## What reproduced

All four documented bounds silently coerce, exactly as specified:

| path | sent | HTTP | stored | documented bound |
| --- | --- | --- | --- | --- |
| `/metadata/template` | `"tcverify-no-such-template"` | **200** | `"onyx"` | enum of 15 names |
| `/metadata/page/format` | `"a3"` | **200** | `"a4"` | enum `[a4, letter, free-form]` |
| `/metadata/page/marginX` | `500` | **200** | `14` | min 0, max 100 |
| `/metadata/typography/body/fontSize` | `999` | **200** | `11` | min 6, max 24 |

Every 200 body is the full resume document with **no error, warning or message of any kind**.

## Controls

1. **An in-enum value persists** — `template = "bronzor"` → 200, stored `bronzor`. The write path works;
   the validation is what is missing.
2. **The bounds without a `.catch()` 400 correctly and preserve state.** `page.gapX` set to `7` → 200; then
   `-5` → **400**, stored still `7`, with a real diagnostic:
   ```json
   {"defined":true,"code":"INVALID_PATCH_OPERATIONS","status":400,
    "message":"Patch produced invalid resume data: [{ \"origin\": \"number\", \"code\": \"too_small\", \"minimum\": 0, … }]"}
   ```
   Across the full 15-bound sweep the split is **3 × 200 / 12 × 4xx** — the twelve correct 400s are the
   control, and every one of them left the stored value untouched. (The brief names eleven; the
   twelfth is `page/gapX`, which is also driven on its own as the named control above.)
3. **The documented non-bug holds.** `/basics/email = "not-an-email-address"` → 200, stored verbatim. That
   is correct: `basicsSchema.email` is a plain `z.string()` at `data.ts:89` and the doc publishes it as a
   plain string. It must not be filed as part of this finding.

## Mechanism, re-read at this SHA

`packages/schema/src/resume/data.ts:627-630`:

```ts
export const metadataSchema = z.object({
	template: templateSchema
		.catch("onyx")
		.describe("The template to use for the resume. Determines the overall design and appearance of the resume."),
```

`.catch()` swallows the parse failure before `parseWritableResumeData`
(`resume-data-validation.ts:23-24`, reached from `service.ts:162`) can turn it into a 400.

## Verdict

**still reproduces** — a class of bug spanning at least four documented bounds, not a one-field
oversight. Raw request/response pairs in [`raw-f9-requests.json`](./raw-f9-requests.json).
