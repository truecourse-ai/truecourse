# Live re-run — NocoBase, 2026-08-20

A from-scratch build of `nocobase/nocobase` at `main`, seeded through the corpus's own
seed script, with every routed finding's probe **and** its control replayed by hand
against the running instance.

**All 13 findings routed as public issues still reproduce. Nothing is fixed, changed, or
unreproducible.** S1 and S2 were not run: both are routed `skip: not a finding`.

| finding | verdict | the decisive observation |
| --- | --- | --- |
| **F13** | still reproduces | `{"alpha":"a1","beta":"b1"}` under a role whose Edit grant is `["alpha"]` gives `200 {"data":[{"id":1,"alpha":"a1","beta":"b0"}]}`, postgres `1|a1|b0`. Control: a role with no update grant gives `403 No permissions`. |
| **UNION-REWRITE** | still reproduces | `X-Role: __union__` under `roleMode=default` returns a byte-identical answer to `X-Role: tcuniona`, and `roles:check` reports the role as `tcuniona`. Controls: `admin` and `tcnosuchrole` give `401 ROLE_NOT_FOUND_FOR_USER`; under `allow-use-union` the same header returns 4 rows with `sex`. |
| **F11.1** | still reproduces | destroyed collection gives `500 Cannot read properties of undefined (reading 'collection')`; never-existed collection gives `404 Not Found`. |
| **F11.2** | still reproduces | `{"name":"amount","interface":"number"}` gives `500 unsupported field type null`; the same request with `"type":"double"` gives 200. |
| **F10** | still reproduces | the api accepts `9tcbad` and `9bad` (both materialized in postgres); the browser form rejects `9tcbad` with `This field is invalid` and no reachable Submit. |
| **F12** | still reproduces | adding `member` (`view:own`) to the two-role user turns the union read from 200 with 4 rows into `403 No permissions`; removing it restores 200; adding a `createdById` column flips it back to 200 with the role set unchanged. |
| **F4** | still reproduces | Role A alone returns 3 rows (Jack, Lily, Jade) where `union.md` prints 2; Role B alone returns 3 (Jack, Jade, James) where it prints 2. The merge itself is correct. |
| **F8** | still reproduces | the Create-collection menu offers exactly 6 items, and the seventh is labelled `Connect to database view`, a name no manual page uses. |
| **F6** | still reproduces | `roles:create` returns `allowNewMenu:false`; only the seeded `admin` and `member` are `true`. |
| **F5** | still reproduces | the only `title` attribute in the whole document is `UI Editor`; `UI Builder` appears nowhere in text or markup. |
| **F7** | still reproduces | the Type radios are `Group`, `Classic page (v1)`, `Modern page (v2)`, `Link`; `getByRole('radio', {name:'Page', exact:true})` gives 0. |
| **F9** | still reproduces | `getByRole('tab')` gives 0, one horizontal-menu entry `Desktop routes`, no `Mobile routes` on the page, while the mobile plugin is `enabled=t builtIn=t`. |
| **SURFACE** | still reproduces | `getByRole('textbox')` gives 1, `getByRole('textbox', {name:'Title'})` gives 0, `element.labels.length` gives 0. |

## Build

| | |
| --- | --- |
| repo | `/Users/musheghgevorgyan/repos/nocobase`, branch `main` |
| sha | `032a4f6913be912f57462d605cbd0bde97b599c6` (committed 2026-08-21), lerna `2.1.45`, `yarn nocobase --version` gives `2.1.45` |
| relation to the tested SHA | the reverify pass tested `d8d8cb4b`; the three commits since are two lerna version bumps and one changelog commit, so head is equivalent. Every mechanism cite quoted in the per-finding files was re-read at **this** sha and matches. |
| install | `yarn install --frozen-lockfile`, exit 0, 291s |
| build | `yarn build`, exit 0, 505s |
| node | v20.19.5 (nvm), yarn 1.22.22 via corepack. The repo's `engines` is `>=18`; the volta pin is 20.16.0. |
| datastore | `docker compose -f reference/seed/compose.yml up -d --wait`, project `tc-nocobase`, PostgreSQL 16 on 127.0.0.1:15432. The host's `docker compose` is **v2.15.1** and parsed the corpus compose file without complaint, so no standalone binary was needed. |
| seed | `node reference/seed/guard-seed.mjs`, exit 0: schema dropped and recreated, `nocobase install` (100 tables), `pm enable @nocobase/plugin-departments`, the union fixture (4 collections, 6 data scopes, 2 roles, the two-role user `tcunion`), and its own proof pass. |
| server | `yarn nocobase start --launch-mode node`, `APP_PORT=14100`, `APP_HOST=127.0.0.1`, health `/api/__health_check` gives `200 ok` |
| env deviations | `SOCKET_PATH=/tmp/tcl/gw.sock` (macOS `sun_path` is 104 bytes and the scratch path is longer, and the failure mode is a misleading `EADDRINUSE`), `STORAGE_PATH=/tmp/tcl/storage` and `APP_ENV_PATH` pointed at an empty scratch file, so the clone's own `storage/` was never written to. Everything else is the recipe's `env` block verbatim. |
| browser | `playwright-core` 1.62.1 from `/Users/musheghgevorgyan/repos/truecourse/packages/guard-runner`. It wants Chromium rev **1234**, which is not installed on this host (neither is `chrome-headless-shell` 1234), so the **full Chromium build of rev 1194** was launched explicitly through `executablePath`, headless. All locators used are version-stable. |

## Method

Every finding was replayed the way the hand-verification report (`../report.md`) states it,
probe and control both, and every response body in the per-finding files is quoted from the
live capture rather than from the report. Where the report's claim was about database
state, the state was read straight out of PostgreSQL with `psql` in the container rather
than inferred from the api's answer.

Fixtures used:

- **the seed's `union-fixture`** for F4, UNION-REWRITE and F12: collection `tcunionmixed`
  (`Jack 23 Man`, `Lily 29 Woman`, `Jade 27 Woman`, `James 31 Man`), roles `tcuniona`
  (`Age < 30`, columns `name,age`) and `tcunionb` (`Name contains "Ja"`, columns
  `name,sex`), user `tcunion` holding exactly those two. This is the same fixture the
  report built by hand under the name `tcmixed`, so the numbers are directly comparable.
- **built by hand for this pass**: `tcfld` plus roles `tcfldr`/`tcvieworr` and users
  `tcflduser`/`tcviewuser` (F13), `9tcbad` (F10, F11.2), `tcdestroy` (F11.1), role `tcnm1`
  (F6).

Ordering mattered in one place: the web probes and every default-mode api probe ran
**before** `roles:setSystemRoleMode` flipped the instance to `allow-use-union`, so
UNION-REWRITE's probe saw the shipped default and F12's probe saw a mode in which the union
genuinely runs.

## Two corrections carried forward, both confirmed

1. **F8's narrative sentence is wrong about Calendar.** `Calendar collection` **is** on the
   Create-collection menu at this sha. The finding's own comparison table (which lists only
   Comment, Expression, Connect external data and Inheritance as absent) is the correct
   half.
2. **F5's cite.** `TopbarActionModel.tsx:378` is `testId = 'ui-editor-button';`. The
   `tooltip = tExpr('UI Editor')` line is `:381`.

And one nuance for F9: the routes page's single `Desktop routes` entry is an `ant-menu`
item, not an `ant-tabs` tab. `getByRole('tab')` finds nothing on that page at all, so a
scenario addressing it by tab role fails for the wrong reason.

## Disk

Checked at every stage, against the 3 GB stop threshold:

| stage | free on `/System/Volumes/Data` |
| --- | --- |
| before install | 30 GB |
| after `yarn install` | 20 GB |
| after `yarn build` | 18 GB |
| after the run and teardown | 18 GB |

Never close to the threshold; no stop was needed.

## Teardown

| created | disposed |
| --- | --- |
| compose project `tc-nocobase` (the recipe's own): container `tc-nocobase-postgres-1`, its network and volumes | `docker compose -f reference/seed/compose.yml down -v` |
| the NocoBase server on port 14100 | killed, verified with `pgrep -f` and `lsof -nP -iTCP:14100` |
| `/tmp/tcl/` (short-path gateway socket and scratch storage) | removed |
| scratch dir with the probe scripts, logs and screenshots | left in the session scratchpad; every decisive value is copied into the per-finding `raw/` directories here |

No other container, image or volume on this host was touched, and `docker system prune` was
never run. No product source, no `yarn.lock` and no corpus file was modified: `git status`
in the clone ends showing only `?? .truecourse/` and `?? reference/`, exactly as it started.
(`yarn install`'s postinstall writes a gitignored `.env` from `.env.example`; that is the
recipe's own install path and it does not appear in `git status`.)
