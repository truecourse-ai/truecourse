---
finding: F9
target: AmruthPillai/Reactive-Resume
route: public issue
title: "Documented resume bounds are silently coerced instead of rejected: a write outside the published schema returns 200 and stores something the client never sent"
labels: "bug, status: needs triage (applied automatically by 1-bug-report.yml); suggested in body: v5, area: integrations"
status: filed
filed_url: https://github.com/AmruthPillai/Reactive-Resume/issues/3368
filed_at: 2026-08-21
reverified: "yes (main @ 3221afda9ddfb03d6cce87927b0ce47338b4cfa8, which is both the commit our corpus tested and today's default-branch head, so zero commits landed in between; live re-run 2026-08-20 against a self-hosted instance built from that commit: all four coercions still reproduce, the twelve control rejections still reject, and the `.catch(` count was re-measured at 34)"
format_note: "Matches .github/ISSUE_TEMPLATE/1-bug-report.yml exactly: every required `### ` header present and non-empty, in template order, with the required Existing-issue checkbox ticked. Dropdown sections carry only real option values, verified against the live template on 2026-08-21 (Product variant = Self-hosted; Area = API & integrations). The optional `Template` section is omitted deliberately: that field's options are the fifteen template names and the bug is not specific to any of them, even though one of the coerced fields happens to be `metadata.template`. `blank_issues_enabled: false` on this repo, so the form shape is mandatory. Own sub-headings demoted to ####."
---

# Documented resume bounds are silently coerced instead of rejected: a write outside the published schema returns 200 and stores something the client never sent

### Existing issue

- [x] I searched the existing issues and could not find a matching report.

Keyword searches plus a sweep of the 800 most recent issues and pull requests turned up three neighbours and no duplicate. The closest is https://github.com/AmruthPillai/Reactive-Resume/issues/3174 (open, labelled `bug` / `area: rendering` / `status: confirmed`), which is the same class of defect on the style-rules surface: a rule whose only property is out of range is dropped silently, and the thread proposes either clamping or telling the user which property was rejected. Different surface, same shape, so it is related rather than a duplicate. Also worth linking: https://github.com/AmruthPillai/Reactive-Resume/issues/3082 (closed as completed) is the request that introduced these bounds in the first place, and https://github.com/AmruthPillai/Reactive-Resume/issues/2818 (closed as completed) is the precedent that a 200 where a 4xx belongs is treated as a bug here.

### Product variant

Self-hosted

### Reactive Resume version

5.2.7 (commit `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` on `main`, 16 commits after the `v5.2.7` tag, so this exact build is not a release)

### Area

API & integrations

### Environment

macOS (Darwin 25.5.0, arm64); self-hosted, built from source with `pnpm install --frozen-lockfile` and `pnpm run build`, run as `node apps/server/dist/index.mjs`, PostgreSQL 18 in Docker. API probes used a cookie-jar `fetch` client sending `Origin`, against the resume update endpoint under `/api/openapi/resumes`.

### Summary

The published JSON Resume schema gives hard bounds for several resume fields: `metadata.template` as a JSON Schema `enum` of exactly fifteen template names with `"default": "onyx"`, `metadata.page.format` as an enum of three, `metadata.page.marginX` as 0 to 100, and the typography font sizes with their own ranges (`docs/guides/json-resume-schema.mdx:3297-3318` for the template block). A write that violates one of those bounds is not refused. The API answers `200`, the response body is the full resume document with no error, warning or message of any kind, and the stored value silently becomes something the client never sent.

Four measured examples, each moved off its default first so the result is a visible rewrite rather than a no-op:

| path | sent | HTTP | stored | documented bound |
| --- | --- | --- | --- | --- |
| `/metadata/template` | `"tcverify-no-such-template"` | **200** | `"onyx"` | enum of 15 names |
| `/metadata/page/format` | `"a3"` | **200** | `"a4"` | enum `[a4, letter, free-form]` |
| `/metadata/page/marginX` | `500` | **200** | `14` | min 0, max 100 |
| `/metadata/typography/body/fontSize` | `999` | **200** | `11` | min 6, max 24 |

**This is a class, not a field.** The cause is Zod `.catch()` on the field schemas, which converts a parse failure into a default before the validation layer can turn it into a 400. Measured at this commit, `packages/schema/src/resume/data.ts` carries **34** `.catch(` sites, on 34 distinct lines. (We measured 34 three ways; an earlier note of ours recorded 30, and that number was simply an undercount. Since today's head is the commit we tested, the file cannot have changed in between. Please recount if it matters, the command is in the logs section.) At least four of those 34 sit directly on bounds the published schema advertises.

The impact is the part worth weighing. A client that typos a template name, or an integration that sends a font size in the wrong unit, receives a success response and a resume that has quietly changed underneath it. There is nothing in the 200 to react to, so the divergence is undetectable at the call site and only shows up later as a resume that does not look like the one the caller thinks it saved.

### Steps to reproduce

Self-hosted, signed in, one resume. Every value below is verbatim from our run against resume `f9-82471292`.

1. Set `metadata.template` to a valid non-default value so the coercion will be visible, for example a JSON Patch `replace` of `/metadata/template` to `"chikorita"`. Response `200`, stored `"chikorita"`.
2. Now patch `/metadata/template` to `"tcverify-no-such-template"`, a name outside the documented enum.
3. Observe `200`. Read the resume back: `metadata.template` is `"onyx"`. The 200 body is the full resume document and carries no diagnostic of any kind.
4. Repeat the same two-step shape for the other three bounds:
   - `/metadata/page/format` set to `"letter"` (200, stored `letter`), then to `"a3"` (200, stored `"a4"`).
   - `/metadata/page/marginX` set to `40` (200, stored `40`), then to `500` (200, stored `14`).
   - `/metadata/typography/body/fontSize` set to `20` (200, stored `20`), then to `999` (200, stored `11`).
5. Control, the write path works: patch `/metadata/template` to `"bronzor"`, an in-enum name. `200`, stored `"bronzor"`. So it is the validation that is missing, not the write.
6. Control, the error path works too: set `/metadata/page/gapX` to `7` (200, stored `7`), then to `-5`. That field has no `.catch()`, and it behaves correctly:

   ```
   -> 400 {"defined":true,"code":"INVALID_PATCH_OPERATIONS","status":400,
           "message":"Patch produced invalid resume data: [ { \"origin\": \"number\", \"code\": \"too_small\", \"minimum\": 0, \"inclusive\": true, \"path\": [\"metadata\",\"page\",\"gapX\"], ... } ]"}
   ```

   Read back afterwards: still `7`.

#### The control in full, since it is what makes this specific

We drove all fifteen bounds the same way in one sweep. The split was **3 accepted, 12 correctly refused**, and every one of the twelve 400s left the stored value untouched:

```
/metadata/template                     replace  200  before="bronzor"        after="onyx"            SILENTLY REWRITTEN
/metadata/page/format                  replace  200  (driven separately off "letter" -> stored "a4")
/metadata/page/marginX                 replace  200  (driven separately off 40       -> stored 14)
/metadata/page/gapX                    replace  400  before=7                after=7                 unchanged
/picture/size                          replace  400  before=100              after=100               unchanged
/picture/rotation                      replace  400  before=0                after=0                 unchanged
/picture/aspectRatio                   replace  400  before=1                after=1                 unchanged
/picture/borderRadius                  replace  400  before=0                after=0                 unchanged
/metadata/design/level/type            replace  400  before="icon"           after="icon"            unchanged
/metadata/stylesheet/mode              replace  400  before="semantic"       after="semantic"        unchanged
/metadata/typography/body/fontFamily   remove   400  before="IBM Plex Serif" after="IBM Plex Serif"  unchanged
/basics                                remove   400  (unchanged)
/metadata/typography                   remove   400  (unchanged)
/picture/shadowWidth                   remove   400  before=0                after=0                 unchanged
/basics/email                          remove   400  before="…@email.com"    after="…@email.com"     unchanged

200s: 3   4xx: 12   (of 15 bounds driven)
```

The twelve refusals are the control. The endpoint, the patch format, the validation layer and the error body all work; the difference between the three that pass and the twelve that fail is a `.catch()` on the field schema.

#### One thing that is not a bug, so it does not get filed here

`/basics/email` accepts `"not-an-email-address"` with a 200 and stores it verbatim. That is correct: `basicsSchema.email` is a plain `z.string()` at `packages/schema/src/resume/data.ts:89` and the published schema documents it as a plain string. We mention it so it is clear we checked it and excluded it deliberately.

### Expected behavior

A write that violates a documented bound should be refused with a `400` naming the offending path, exactly as `/metadata/page/gapX` already is, and the stored document should be left untouched. That is the product's own behaviour on twelve of the fifteen bounds we drove, so this is asking for consistency rather than for a new policy.

Concretely: drop `.catch()` from the field schemas whose bounds the JSON Resume guide publishes (`template` at `data.ts:629`, `format` at `:462`, `marginX` at `:457`, `marginY` at `:458`, `fontSize` at `:417`, `lineHeight` at `:422`), and let `parseWritableResumeData` do its job. If `.catch()` is needed for reading legacy documents that already hold out-of-range values, the natural split is to keep a lenient schema on the read path and use a strict one on the write path, so old resumes still load while new writes are validated.

If clamping is preferred to rejecting, that is defensible, but then the response has to say so. A 200 that silently stores a different value than the one submitted is the part a client cannot work around. This is the same choice the maintainer thread on the style-rules issue reaches, where the options offered are to clamp or to tell the user which property was rejected.

Either way, `docs/guides/json-resume-schema.mdx` should end up describing what actually happens, since today it publishes bounds that the API does not enforce.

### Actual behavior

The API answers `200` with the full resume document and no diagnostic, and the stored value is silently replaced by the schema default: `"tcverify-no-such-template"` becomes `"onyx"`, `"a3"` becomes `"a4"`, `500` becomes `14`, `999` becomes `11`.

#### Cause

Read at `3221afda9ddfb03d6cce87927b0ce47338b4cfa8`:

- `packages/schema/src/resume/data.ts:627-630`:

  ```ts
  export const metadataSchema = z.object({
  	template: templateSchema
  		.catch("onyx")
  		.describe("The template to use for the resume. Determines the overall design and appearance of the resume."),
  ```

  https://github.com/AmruthPillai/Reactive-Resume/blob/3221afda9ddfb03d6cce87927b0ce47338b4cfa8/packages/schema/src/resume/data.ts#L627-L630

- `templateSchema` is the fifteen-name `z.enum` at `packages/schema/src/templates.ts:3-18`, that is, the enum the guide publishes.
- `.catch()` resolves the parse failure to the default **before** `parseWritableResumeData` (`packages/api/src/features/resume/resume-data-validation.ts:23-24`, reached from `packages/api/src/features/resume/service.ts:162`) can turn it into a 400. The validation layer never sees a failure, so it has nothing to report.
- The other coercion sites on documented bounds, same file: `fontSize` `:417`, `lineHeight` `:422`, `marginX` `:457`, `marginY` `:458`, `format` `:462`.
- Scale of the pattern: `grep -c '\.catch(' packages/schema/src/resume/data.ts` returns **34** at this commit.

A note on the variant dropdown, since it takes only one value: we drove a **self-hosted** build. The code involved is the shared schema package with no deployment branch of any kind, so the cloud deployment runs the identical path. Please do not read the dropdown as narrowing this to self-hosted installs.

### Logs and screenshots

No screenshot is needed: every decisive value is a stored field read back over the API, quoted above.

The `.catch(` count, measured three ways at this commit, all agreeing:

```
$ grep -c '\.catch(' packages/schema/src/resume/data.ts
34
$ grep -o '\.catch(' packages/schema/src/resume/data.ts | wc -l
34
$ grep -n '\.catch(' packages/schema/src/resume/data.ts | wc -l
34
```

The control's 400 body in full, which is what a correct refusal looks like on this endpoint:

```json
{"defined":true,"code":"INVALID_PATCH_OPERATIONS","status":400,
 "message":"Patch produced invalid resume data: [\n  {\n    \"origin\": \"number\",\n    \"code\": \"too_small\",\n    \"minimum\": 0,\n    \"inclusive\": true,\n    \"path\": [\n      \"metadata\",\n      \"page\",\n      \"gapX\"\n    ], ... } ]"}
```

#### Suggested labels

`bug`, `status: needs triage` (both applied by the form), plus `v5` and `area: integrations`. Our account cannot apply labels itself.

Deliberately **no** deployment label: the defect is in the shared schema package with no deployment branch, so narrowing it to either cloud or self-hosted would be wrong.

Found by TrueCourse running the product's published documentation against a live instance; the full transcript (every request and response pair, including the twelve control rejections and the values read back after each one) is available on request.
