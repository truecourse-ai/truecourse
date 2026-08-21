# Live re-run — Reactive-Resume

**Date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` on `main`
(`3221afda Sync Translations from Crowdin (#3365)`) · **Findings re-run:** 12 of 13
(F10 is routed `skip: not a finding` and was not re-run).

`origin/main` head **is** the commit the 2026-08-21 hand verification tested, so this re-run drives
exactly the code that was hand-verified. The tree is 16 commits past the `v5.2.7` tag, so none of it is
in a release.

## Verdicts

| finding | verdict | the one line that lands it |
| --- | --- | --- |
| **F3** `downloads` has no write path | **still reproduces** | An anonymous visitor received a real `resume.pdf` (241,590 bytes, `%PDF-`) while `downloads` stayed `0`; `views` moved `0 → 1` in the same session |
| **F4** views deduped per client per hour | **still reproduces** | `0 → 1 → 1 → 1 → 2 → 3` |
| **F7** `FormControl` id lands on an unlabelable wrapper | **still reproduces** | `Slug → FIELDSET`, `Tags → DIV`, `Sidebar Width → DIV[role=group]`; 2 of 15 spinbuttons anonymous |
| **F8** `Sort by` / `Filter by` anonymous | **still reproduces** | 2 comboboxes, both `aria-label: null`; both `<label>`s have `htmlFor: null` |
| **F9** documented bounds silently coerced | **still reproduces** | 4 silent 200 rewrites; 12 correct 400s as the control; **34** `.catch(` lines |
| **D2** format buttons never spinner/disable | **still reproduces** | `disabled: false` at every sample; dialog gone by 316 ms |
| **D8** one password field, no Confirm | **still reproduces** | 1 input, `"Confirm"` absent; API 400s on a 6-character shortfall |
| **D13** Undo disabled after a restore | **still reproduces** | The app's own confirm says "the builder's undo history is reset" |
| **D14** template switch is a throttled autosave | **still reproduces** | Virgin resume: one row labelled `Manual save`; switches 2 and 3 wrote nothing |
| **D24** `Free-Form` vs `Free-form` | **still reproduces** | `["A4","Letter","Free-form"]` |
| **D25** Template section has no gallery | **still reproduces** | One preview (the current template); all 15 live in an undocumented modal |
| **D26/D27** no `Hidden` switch, heading opens nothing | **still reproduces** | 0 dialogs, 0 menus, 0 `Hidden` switches |

**All 12 still reproduce.** Nothing was fixed, changed, or failed to reproduce.

## The headline, F3, end to end

The one that had to land end to end did. An anonymous browser context — `cookies: 0`, signed in to
nothing — loaded the public resume page and pressed its own `Download PDF` button:

```
F3 stats BEFORE any visit:              {"isPublic":true,"views":0,"downloads":0,"lastViewedAt":null,"lastDownloadedAt":null}
F3 visitor loaded public page; cookies: 0
F3 stats AFTER visitor load (control):  {"isPublic":true,"views":1,"downloads":0,"lastViewedAt":"2026-08-21T03:22:21.178Z","lastDownloadedAt":null}
F3 browser download event:              download event: resume.pdf
F3 downloaded file:                     241590 bytes, magic="%PDF-"
F3 stats AFTER visitor Download PDF:    {"isPublic":true,"views":1,"downloads":0,"lastViewedAt":"2026-08-21T03:22:21.178Z","lastDownloadedAt":null}

F3 VERDICT downloads / lastDownloadedAt: 0 / null
F3 CONTROL views / lastViewedAt:         1 / "2026-08-21T03:22:21.178Z"
```

The control is what makes it land: `views` and `lastViewedAt` moved beside the dead counters **in the
same session, on the same request path**, so the statistics pipeline, the resume, the visitor and the
reader are all demonstrably working — only the download half is dead. The downloaded PDF is kept at
[`F3/download-resume.pdf`](./F3/download-resume.pdf) and the event record in
[`F3/raw-f3.json`](./F3/raw-f3.json).

Repo-wide at this SHA: `grep -rn "downloads: true" apps/ packages/` → **0 matches**; the sole
`statistics.increment` call site is `service.ts:550`, passing `views: true`. The increment existed at
v5.0.0/v5.0.1 in `src/integrations/orpc/router/printer.ts` and that whole path is gone from v5.1.0 on.

## The `.catch(` count

Measured three ways at this SHA, all agreeing:

```
$ grep -c '\.catch(' packages/schema/src/resume/data.ts          → 34
$ grep -o '\.catch(' packages/schema/src/resume/data.ts | wc -l  → 34
$ grep -n '\.catch(' packages/schema/src/resume/data.ts | wc -l  → 34
```

**34**, on 34 distinct lines. This confirms the re-verify and **not** the hand-verification report's 30.
Head is the tested commit so the file cannot have moved; 30 was an undercount. A filer should write
"more than thirty coercion sites, of which at least four sit on bounds the published JSON schema
advertises" rather than quote a figure a maintainer will recount.

## Corrections and refinements this re-run adds

Each is recorded in the finding's own `repro.md`. None weakens a finding.

| finding | what this run pins down |
| --- | --- |
| **D8** | Stronger than recorded. The field *does* carry HTML `minLength=6`/`maxLength=64`, but in a prompt they are unenforced: typing `"abc"` and pressing `Set Password` **closed the dialog**, left `hasPassword` at `false`, and gave the user no explanation. The dialog does not merely omit the confirm field, it silently fails the write. |
| **D26/D27** | Clicking the `<h2>` section heading does **nothing at all** (`aria-expanded: true → true`, no lines change). The collapse the report attributed to the heading belongs to the separate `Toggle Experience section` chevron, which removes exactly `["Cascade Studios","Senior Game Developer","Add a new experience"]`. Both readings agree the guide's instruction opens nothing. |
| **D2** | The `isExporting` guards are at `:141`, `:159` and `:177`; the JSON button near `:196` is guarded by `jsonDisabled`, not `isExporting` — correcting the report's `:141, :159, :178, :196`. This machine produced the PDF in 171 ms rather than 823 ms, which changes the arithmetic and not the finding. |
| **F9** | 34 `.catch(` lines, not 30. The 15-bound sweep splits **3 × 200 / 12 × 4xx**; the brief's "11 bounds without a `.catch()`" plus `page/gapX` (driven separately as the named control) accounts for the twelve. |
| **D25** | The section's accessibility tree shows four `img` nodes, but three are SVG icons; there is exactly **one** real `<img>` element, the current template's preview. The finding is unaffected. |
| **F4** | The dedup key on this direct-to-loopback run was the user-agent + accept-language fingerprint. On a proxied deploy `clientKeyFromHeaders` prefers the trusted-proxy IP header, which collapses the whole audience into one hourly bucket. |

## How this was run

| step | what happened |
| --- | --- |
| services | `docker compose -f reference/seed/compose.yml up -d --wait` → project `tc-rxresume`, container `tc-rxresume-postgres-1`, postgres 18 on `127.0.0.1:54340`. The host's `docker compose` **v2.15.1 parsed the corpus compose file without complaint** (it carries no inline `configs.content`), so no standalone compose binary was needed. |
| install | `npx --yes pnpm@11.22.0 install --frozen-lockfile` — 26 s (warm pnpm store), `node_modules` 1.5 GB |
| build | `npx --yes pnpm@11.22.0 run build` — 14 s, 3/3 tasks successful → `apps/server/dist/index.mjs`, `apps/web/dist/` |
| serve | `node apps/server/dist/index.mjs` on port **54490**, `DATABASE_URL` → 54340, `AUTH_SECRET=guard-reference-auth-secret`, `FLAG_DISABLE_API_RATE_LIMIT=true`, `NODE_ENV=production`. `/api/health` → `{"status":"healthy","database":{"status":"healthy"},"storage":{"type":"local","status":"healthy"}}`; `/auth/login` → 200 |
| seed | `node reference/seed/guard-seed.mjs` — created `guard-owner@rxresume.test`, verified the address through the console-logged link, created `seed-1 … seed-6` and `seed-public`, wrote the sentinel, published |
| browser | `playwright-core@1.62.1` from `packages/guard-runner`. **`chrome-headless-shell` rev 1234 is absent** from this machine's `ms-playwright` cache, so probes ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`. Web probes used Playwright's own accessibility computation (`getByRole({name})`, `getByLabel`, `ariaSnapshot()`); API probes used a cookie-jar `fetch` client sending `Origin`, the same shape the seed uses. |

### Disk

Checked at each of the three required points; never close to the 3 GB floor.

| point | free on `/System/Volumes/Data` |
| --- | --- |
| before install | **18 Gi** |
| after install | **15 Gi** |
| after build | **15 Gi** |
| at the end of the run | **16 Gi** |

### Teardown

| created | disposed |
| --- | --- |
| compose project `tc-rxresume` (container `tc-rxresume-postgres-1`, network `tc-rxresume_default`, image `postgres:18`) | `docker compose -f reference/seed/compose.yml down -v` |
| one `node apps/server/dist/index.mjs` on port 54490 | killed; port confirmed free with `lsof` |
| Chromium processes (playwright-core) | closed with their browsers |
| the seeded account and every probe resume | gone with the database |
| scratch scripts | in the session scratchpad, outside the repo |

No other container, image or volume was touched, and `docker system prune` was never run. Docker had
zero containers before this run and zero after. Nothing in the product source, the lockfile or any
corpus file was modified: `git status` in the checkout ends showing only the pre-existing untracked
`.truecourse/` and `reference/`.

## Layout

```
live/
├── REPORT.md          this file
├── summary.json       machine-readable verdicts
├── F3/  repro.md · raw-f3.json · f3-console.txt · download-resume.pdf   ← the download event
├── F4/  repro.md · raw-f4.json · f4-console.txt
├── F7/  repro.md · raw-f7.json · f7-console.txt
├── F8/  repro.md · raw-f8.json · f8-console.txt · dashboard-control-strip.png
├── F9/  repro.md · raw-f9-requests.json · f9-console.txt
├── D2/  repro.md · raw-d2.json · d2-console.txt
├── D8/  repro.md · raw-d8.json · d8-console.txt
├── D13/ repro.md · raw-d13.json · d13-console.txt
├── D14/ repro.md · raw-d14.json · d14-console.txt
├── D24/ repro.md · raw-d24.json · d24-console.txt · format-options.png
├── D25/ repro.md · raw-d25.json · d25-console.txt · template-gallery-modal.png
└── D26-D27/ repro.md · raw-d26-d27.json · d26-d27-console.txt
```
