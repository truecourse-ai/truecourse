# D8 — the set-password prompt has one field and no Confirm

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


**Doc quote**, `docs/guides/sharing-your-resume-publicly.mdx:134`:

> Type a password (6-64 characters) and confirm. This password will be required to view your resume.

## Probe and controls

```
=== D8 · the Sharing section, before ===
- heading "Toggle Sharing section" [level=3]:
  - button "Toggle Sharing section" [expanded]:
    - img
- img
- heading "Sharing" [level=2]
- region "Toggle Sharing section":
  - switch "Allow Public Access Anyone with the link can view and download the resume."
  - text: Allow Public Access Anyone with the link can view and download the resume.

after Allow Public Access, section:
- heading "Toggle Sharing section" [level=3]:
  - button "Toggle Sharing section" [expanded]:
    - img
- img
- heading "Sharing" [level=2]
- region "Toggle Sharing section":
  - switch "Allow Public Access Anyone with the link can view and download the resume." [checked]
  - text: Allow Public Access Anyone with the link can view and download the resume. URL
  - textbox "URL": http://127.0.0.1:54490/guardowner/d8-82982114
  - button "Copy URL":
    - img
  - paragraph: Optionally, set a password so that only people with the password can view your resume through the link.
  - button "Set Password":
    - img
    - text: Set Password

'Set Password' buttons: 1

=== D8 · PROBE: the whole prompt, verbatim from Playwright's accessibility tree ===
- alertdialog "Protect your resume from unauthorized access with a password":
  - heading "Protect your resume from unauthorized access with a password" [level=2]
  - paragraph: Anyone visiting the resume's public URL must enter this password to access it.
  - textbox
  - button "Cancel"
  - button "Set Password"

password inputs in the prompt                1
ALL inputs in the prompt                     1
inputs on the whole page: before -> after    45 -> 46
page text contains "Confirm Password"        false
page text contains "Confirm"                 false
getByLabel('Confirm Password').count()       0
page text contains "6-64"                    false
page text contains "6 to 64"                 false

the single field's attributes: [{"type":"password","placeholder":"","ariaLabel":null,"minLength":6,"maxLength":64,"label":null}]
  (F7 family: that one field is itself anonymous — ariaLabel null, label null)

=== D8 · does the DIALOG itself block a 3-character password? ===
typed "abc" (3 chars) and pressed Set Password
  prompt still open afterwards:        0
  resume.hasPassword after the attempt: false
  visible feedback line:               "Optionally, set a password so that only people with the password can view your resume through the link."

=== D8 · CONTROL: the API really does enforce min(6).max(64) (dto/resume.ts:75) ===
PUT /api/openapi/resumes/01a0225e-04e8-729f-a56b-701e119c7d6b/password {"password":"abc"}  -> 400
   body: {"defined":false,"code":"BAD_REQUEST","status":400,"message":"Input validation failed","data":{"issues":[{"origin":"string","code":"too_small","minimum":6,"inclusive":true,"path":["password"],"message":"Too small: expected string to have >=6 characters"}]}}
PUT ... {"password":"sixchars"}                              -> 200

So the documented 6-64 rule is real and server-enforced; the dialog neither states it nor confirms it.
```

## What reproduced

One field. No second field. The word "Confirm" does not appear anywhere on the page, and neither does
the character range the doc quotes. `45 → 46` inputs on the page: exactly one new field.

**Control:** the prompt did open and did render a `type="password"` input, so the absence is of the
*confirm* field specifically, not of the prompt.

**Control:** the 6-64 rule is genuine and server-enforced, at `packages/api/src/dto/resume.ts:75`
(`password: z.string().min(6).max(64)`):

```
PUT /api/openapi/resumes/<id>/password  {"password":"abc"}       -> 400
  {"code":"BAD_REQUEST","status":400,"message":"Input validation failed",
   "data":{"issues":[{"code":"too_small","minimum":6,"path":["password"],
                      "message":"Too small: expected string to have >=6 characters"}]}}
PUT /api/openapi/resumes/<id>/password  {"password":"sixchars"}  -> 200
```

So the doc is accurate about the constraint and the dialog is the half that does not implement it.

## Two refinements this re-run adds

1. **The field does carry `minLength=6` / `maxLength=64`** as HTML attributes (from `sharing.tsx:58-61`
   `inputProps`). They are invisible to the reader and, being a prompt rather than a form submit, they
   are **not enforced**: typing `"abc"` and pressing `Set Password` **closed the prompt**
   (`prompt still open afterwards: 0`), left `resume.hasPassword` at **`false`**, and produced no visible
   explanation. The user is told nothing; the password is simply not set. This is stronger than
   "no confirm field", and it is the same shape as the doc-drift.
2. **F7 family:** that single password field is itself anonymous —
   `{"type":"password","placeholder":"","ariaLabel":null,"label":null}`.

## Verdict

**still reproduces**
