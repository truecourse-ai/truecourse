# Hand verification — NocoBase findings, 2026-08-21

Independent re-verification of the product-bug findings in `reference/findings.md`
and `reference/run-classification.md` §9.7, against a **clean instance** built from
scratch on this date. Nothing in the corpus store, the seed, or the NocoBase source
was used to produce the state below — the fixtures here were rebuilt by hand through
the product's own api, and the seed script was read only for its idioms.

Subject: `nocobase/nocobase` at `d8d8cb4b12cbe41b6c0b9412bbaa8aa294947014`
(verified: `git log -1` → `d8d8cb4b12cbe41b6c0b9412bbaa8aa294947014 2026-08-19`;
`yarn nocobase --version` → `2.1.43`). No product source and no `yarn.lock` was
modified; `git status` before and after shows only the two untracked dirs
`?? .truecourse/` and `?? reference/`.

Every verdict below carries a probe **and** a control. Verbatim response bodies are
quoted; where a browser was needed the decisive DOM text is inlined so the report
stands without its screenshots.

---

## Cross-reference — corpus scenarios and upstream issues/PRs

Scenario ids and failing steps are from the converged board
(`run-classification.md` §3); upstream states were re-checked read-only on
2026-08-21 (`gh api search/issues` GETs, nothing created or commented). **Every
finding below is unreported upstream** — the only artefacts that touch any of
them are noted inline.

| finding | corpus scenario (failing step) | upstream (nocobase/nocobase) |
| --- | --- | --- |
| **S1** `install` outside a live server is an unawaited-`runAsCLI` race | no board scenario — layer-4 install-path finding | **unreported** |
| **S2** `install -f` drops then refuses to reinstall | no board scenario — and NOT reproduced by this report (§2: likely S1 wearing a different hat) | **unreported** |
| **F10** identifier validation is browser-only | `a-collection-name-is-chosen-once-and-then-fixed.api.1` (2) · `a-field-identifier-is-validated-once-and-then-fixed.api.1` (7) | **unreported** |
| **F11.2** `fields:create` with interface, no type → 500 | `a-field-interface-carries-a-default-data-type-and-allows-others.api.1` (3) | **unreported** |
| **F11.1** destroyed collection → 500 where 404 belongs | `collections-are-listed-filtered-and-deleted-with-their-tables.api.1` (10) | **unreported** |
| **F13** Edit grant silently discards ungranted fields | `field-permissions-decide-which-fields-a-role-may-read-and-write.api.1` (17) | **unreported** |
| `__union__` silently rewritten to `userRoles[0]` | `roles-are-used-one-at-a-time-under-independent-roles.api.1` (6) | **unreported** |
| **F6** api-minted roles get `allowNewMenu: false` | `new-menu-items-are-accessible-by-default.api.1` (5) | **unreported** |
| **F4** `union.md`'s worked example wrong | `role-union-merges-rows-and-columns-separately.api.1` (4) | **unreported** (union hits #9611/#9632/#7198 are unrelated code fixes) |
| **F12** `view:own` role poisons the union | `role-union-merges-the-rows-either-role-may-see.api.1` (6) — SEED-class red | **unreported** |
| **F5** docs say `UI Builder`, product says `UI Editor` | `the-ui-builder-button-arrives-with-the-configure-interface-permission.web.1` (9) | **unreported** — [#7758](https://github.com/nocobase/nocobase/pull/7758) (open) touches the docs' nav label only, not the drift |
| **F7** the four documented route types are not the form's four | `the-route-type-list-is-what-the-add-route-form-offers.web.1` (7) | **unreported** |
| **F8/D4** six of twelve collection types; database-view entry misnamed | `the-create-collection-menu-offers-the-documented-collection-types.web.1` (10) | PR [#10009](https://github.com/nocobase/nocobase/pull/10009) **merged 2026-07-07** made the removals deliberate and left the handbook alone; [#10286](https://github.com/nocobase/nocobase/pull/10286) closed, not merged; [#9930](https://github.com/nocobase/nocobase/pull/9930) open draft (Chinese docs only) |
| **F9** one Routes endpoint, no Mobile-routes tab | `a-page-route-is-created-and-reaches-both-the-menu-and-its-page.web.1` (6) | **unreported** |
| SURFACE — route drawer's `Title` input has no accessible name | `a-route-can-be-created-without-showing-in-the-menu.web.1` (6) | **unreported** (a11y) |

---

## Setup

| | |
| --- | --- |
| database | a **new** PostgreSQL 16 container, compose project **`tcverify-nocobase`**, published on **127.0.0.1:15532**. The corpus's own project `tc-nocobase` (127.0.0.1:15432) was never started, never connected to, and is still `Exited (0)`. |
| app | the monorepo app, `yarn nocobase start --launch-mode node`, `APP_PORT=14100`, `APP_HOST=127.0.0.1`. Existing build output was reused (`packages/core/app/lib/index.js`, `packages/core/app/dist/client/`); **no `yarn install` and no `yarn build` was run.** |
| node | v20.20.2 first on `PATH` (`~/.local/share/fnm/node-versions/v20.20.2/installation/bin`). |
| env | `APP_ENV_PATH` pointed at a scratch env file so the repo's `.env` could not leak in; `STORAGE_PATH` pointed at a scratch dir so the corpus's `storage/` was untouched. |
| admin | `admin@nocobase.com` / `TcGuard1!`, created by the installer from `INIT_ROOT_*`. |
| plugins | stock install only. `@nocobase/plugin-departments` was **not** enabled — no finding here needs it. |

### One environment note worth recording

`SOCKET_PATH` must be short. The scratch dir's natural path is 181 bytes, over
macOS's 104-byte `sun_path` limit, and the gateway's IPC socket then fails to bind
with a misleading **`EADDRINUSE`** rather than a name-too-long error — with no
socket file on disk. Moving `SOCKET_PATH` to `/tmp/tcv/gw.sock` fixed it. Until
that was found, a `nocobase install` issued "against a live server" was silently
taking the *cold CLI* path instead, because the server had died on boot. Any future
verification that thinks it is exercising the IPC path should check that the server
is answering first.

---

## 1. S1 — `nocobase install` outside a running server is an unawaited-`runAsCLI` race

**VERDICT: PARTIAL.** The mechanism is present in the source exactly as described.
The race **did not land in 15 attempts**, and every one of those installs produced a
database indistinguishable from the supported path.

### Mechanism (verified at this SHA)

- `packages/core/app/src/index.ts:13-21` — `initializeGateway()` does
  `await Gateway.getInstance().run({ mainAppOptions: config })` and nothing else.
  There is no other handle holding the loop.
- `packages/core/server/src/gateway/index.ts:654` — `async run(options)`.
- `packages/core/server/src/gateway/index.ts:706-724` — the CLI is kicked off
  **without `await`**:

  ```ts
  mainApp
    .runAsCLI(...runArgs)
    .then(async () => { … })
    .catch(async (e) => { … });
  ```

  `run()` resolves as soon as that promise chain is *registered*, so
  `initializeGateway()` returns while the install is still in flight. The cite in
  `findings.md` / `recipe-notes.md` (`gateway/index.ts:706-725`) is accurate.
- `packages/core/server/src/commands/install.ts:16` — `install` is declared
  `.ipc()`, which is what makes the live-server path deterministic.

### Probe

Fifteen cold installs, each against a freshly dropped-and-recreated `public`
schema, with no server listening on `SOCKET_PATH`:

- runs 1-6, idle host
- runs 7-12, under eight-way CPU contention (spinners) to shift the loop timing
- runs 13-15, idle again

**Every one: `exit=0`, 6-10s, `tables=100 users=1 roles=3 authenticators=1
applicationVersion=1`.** Not one truncated install, not one empty
`authenticators`, not one 3-table stop.

### Control — is "exit 0 with 100 tables" actually a *complete* install?

Per-table row counts were snapshotted (`information_schema.tables` × `count(*)`)
after a cold install and after an install handed to a **live** server over IPC.
They differ in three tables:

```
aiEmployees        0  vs  8
aiSkills           0  vs  6
rolesAiEmployees   0  vs 20
```

That looked at first like the race landing quietly. It is not: **booting the
server on the cold-installed database seeds those three tables**, after which the
two snapshots are byte-identical across all 100 tables. So the AI-employee rows
are first-boot state, not install state, and the cold install is complete.

### Reading

The defect is real in the source and the corpus's four observations are not
disputed — a promise nobody awaits is a race whether or not it fires today. It
simply would not reproduce on this host in 15 tries, so it cannot be called
confirmed by execution. If it is ever chased again, the productive knob is
probably *not* CPU load — it is whatever makes the event loop momentarily
handle-free during the install.

---

## 2. S2 — `install -f` drops everything and then refuses to reinstall

**VERDICT: NOT REPRODUCED.** `install -f` dropped everything **and reinstalled
correctly**, six times out of six, including once against the exact state the
corpus describes.

### Mechanism (verified at this SHA)

`packages/core/server/src/application.ts:1031-1039` — the cite is accurate:

```ts
async install(options: InstallOptions = {}) {          // :1031
  const reinstall = options.clean || options.force;
  if (reinstall) {
    await this.db.clean({ drop: true });               // :1034
  }
  if (await this.isInstalled()) {                      // :1036
    this.log.warn('app is installed');
    return;
  }
```

and `isInstalled()` at `:1025-1029` asks
`collectionExistsInDb('applicationVersion') || collectionExistsInDb('collections')`.

The claimed failure needs `isInstalled()` to answer **true** after the drop. On
this instance it answers false — `db.clean({drop:true})` really removes both
tables — so control falls through to the full reinstall.

### Probe

- **Runs 1-5**, against a stock-installed database, no server running:
  `exit=0` each time, `tables=100 users=1 roles=3 authenticators=1`,
  **`grep -c 'app is installed'` = 0** in every log (`LOGGER_LEVEL=warn`, so that
  warning would have been printed had the branch been taken), and `users.createdAt`
  advancing on every run — `22:37:21`, `22:37:29`, `22:37:36`, `22:37:43` — which
  is a *new* root account per run, i.e. a real reinstall.
- **Run 6, the faithful one**, against a fully-used instance (5 collections
  including `9tcbad`/`tcfld`/`tcmixed`, 4 users, 8 roles, 103 tables):

  ```
  exit=0 · refusal lines: 0
  tables=100 users=1 roles=3 authenticators=1 applicationVersion=1
  user collections left: 0 · collections rows: 2
  users.createdAt: 2026-08-20 23:06:15.809+00
  ```

### Control

After run 6 the server was booted on that database: `/api/__health_check` → **200**,
and `POST /api/auth:signIn` with the root credentials → **200**. A database the
corpus describes as left empty and unusable is here fully installed and signable-in.

### Reading

`install -f` **is** destructive — it drops the whole schema, which is what `--force`
means — so the first half of the finding stands as a warning. The second half ("and
then refuses to reinstall") did not happen once. Two of the corpus's three recorded
S2 symptoms ("104 tables, seeded NO data" and "dropped every table and exited 0
having recreated nothing") are exactly what the **S1** race would produce on this
longer code path, which suggests S2 may be S1 wearing a different hat rather than an
independent defect.

---

## 3. F10 — identifier validation is a browser rule; the api takes anything

**VERDICT: CONFIRMED**, both halves, with a browser-side control that is stronger
than the source cite.

### Doc

`data-sources/data-source-main/general-collection.md:35`, the Collection name row:

> The internal identifier used by APIs, relation fields, permissions, and workflows.
> It is generated automatically but can be changed before creation. **It supports
> letters, numbers, and underscores and must start with a letter.**

`data-sources/data-modeling/collection-fields/system-info/created-by.md:34`, the
Field name row:

> The field identifier used internally by APIs, relation fields, permissions, and
> workflows. It usually cannot be changed after creation. **It supports only letters,
> numbers, and underscores, and must begin with a letter.**

### Probe — the api

```
POST /api/collections:create {"name":"9tcbad","title":"TC Bad Name","template":"general"}
→ 200 {"data":{"inherit":false,"hidden":false,"key":"91e4lhhuvsd","name":"9tcbad",
        "title":"TC Bad Name","description":null,"template":"general",
        "createdAt":false,"createdBy":false,"updatedAt":false,"updatedBy":false,
        "filterTargetKey":"id","unavailableActions":[]}}

POST /api/collections/9tcbad/fields:create {"name":"9bad","type":"string","interface":"input"}
→ 200 {"data":{"key":"o6lbdnxtqno","name":"9bad","type":"string","interface":"input",
        "collectionName":"9tcbad", …}}
```

Both are materialized in PostgreSQL:

```
information_schema.tables   → 9tcbad
information_schema.columns  → id (bigint), 9bad (character varying)
```

(The `createdAt:false … updatedBy:false` in that response is the separate,
already-known fact that `collections:create` presets nothing.)

### Control — the browser refuses the same string

`packages/core/client/src/collection-manager/templates/properties/index.ts:28` carries
`'x-validator': 'uid'` on the Collection name field, with the product's own
description one line below (`:30-31`). Read off the live Create-collection drawer,
verbatim:

> Randomly generated and can be modified. Support letters, numbers and underscores,
> must start with a letter.

Typing `9tcbad` into that field and blurring it produces, from the form itself:

```
validation errors shown by the form: ["This field is invalid"]
Submit present: 0
```

So the rule the manual states **is** enforced — in the browser, and only there.
The same string posted at the api creates a real table.

---

## 4. F11.2 — `fields:create` with an interface and no type answers 500

**VERDICT: CONFIRMED.**

### Probe

```
POST /api/collections/9tcbad/fields:create {"name":"amount","interface":"number"}
→ 500 {"errors":[{"message":"unsupported field type null"}]}
```

### Control — the identical request with an explicit type

```
POST /api/collections/9tcbad/fields:create {"name":"amount2","type":"double","interface":"number"}
→ 200 {"data":{"key":"0qob2g0wh0z","name":"amount2","type":"double","interface":"number",
        "collectionName":"9tcbad", …}}
```

### Mechanism

`packages/core/database/src/database.ts:779` — `throw Error(\`unsupported field type ${type}\`)`.
A bare `Error`, so the koa error handler renders it 500 rather than 400.

### Doc

`data-sources/data-modeling/collection-fields/index.md:64`:

> Each Field interface has a default data type. For example, a field with the Number
> interface uses `double` by default, but it can also use `float`, `decimal`, and
> other data types.

`double` is precisely the type the control had to supply by hand.

---

## 5. F11.1 — a data request to a destroyed collection answers 500, not 404

**VERDICT: CONFIRMED**, and the control pair makes the "404 belongs here" claim
exact rather than rhetorical.

### Probe

```
POST /api/collections:create   {"name":"tcdestroy","title":"TC Destroy","template":"general"}   → 200
POST /api/collections/tcdestroy/fields:create {"name":"label","type":"string","interface":"input"} → 200
POST /api/tcdestroy:create     {"label":"row one"}   → 200 {"data":{"id":1,"label":"row one"}}
GET  /api/tcdestroy:list       → 200 {"data":[{"id":1,"label":"row one"}],"meta":{"count":1,…}}

POST /api/collections:destroy?filterByTk=tcdestroy   → 200 {"data":1}
```

The destroy is correct: the table is gone from PostgreSQL
(`information_schema.tables` count for `tcdestroy` → `0`).

```
GET /api/tcdestroy:list
→ 500 {"errors":[{"message":"Cannot read properties of undefined (reading 'collection')"}]}
```

### Control — what the product answers for a name that never existed

```
GET /api/tcneverexisted:list
→ 404 Not Found
```

Same shape of question, two answers. 404 is not an opinion about what *should*
happen — it is what this very api does for the only other way a collection can be
absent.

### Mechanism (sharper than the cite in `findings.md`, which gives none)

- `packages/core/actions/src/utils.ts:26-39` — `getRepositoryFromParams(ctx)` ends at
  `return ctx.db.getRepository<Repository>(resourceName)`, which is `undefined` once
  the collection is gone. The resourcer route outlives the collection.
- `packages/core/actions/src/actions/list.ts:37` —
  `let { simplePaginate } = repository.collection?.options || {};`
  The optional chaining guards `.options`, one level too deep: `repository` itself is
  the undefined one, so reading `.collection` off it throws
  `TypeError: Cannot read properties of undefined (reading 'collection')`.
  Confirmed against the live server's own stack (`listWithPagination …/actions/list.js:66:46`).

---

## 6. F13 — a field outside the Edit grant is silently discarded, not refused

**VERDICT: CONFIRMED.** This is the sharpest finding in the set and it reproduces
exactly.

### Fixture (built by hand through the api)

- collection `tcfld` with fields `alpha`, `beta`; one row `{id:1, alpha:"a0", beta:"b0"}`
- role `tcfldr` with an individual grant on `tcfld`, `usingActionsConfig: true`:
  - `view` on `["id","alpha","beta"]`
  - `update` on **`["alpha"]` only**
- user `tcflduser` created with `roles: ["tcfldr"]`, so it holds exactly one role
  (checked in `rolesUsers`: `tcflduser|tcfldr`, one row — the implicit-`member` hook
  the seed warns about did not fire)

### Probe

```
row before (raw postgres):  1|a0|b0

POST /api/tcfld:update?filterByTk=1
  X-Role: tcfldr
  {"alpha":"a1","beta":"b1"}
→ 200 {"data":[{"id":1,"alpha":"a1","beta":"b0"}]}

row after (raw postgres):   1|a1|b0
```

200. `alpha` written. `beta` **silently dropped** — and the response body says so
itself, returning `"beta":"b0"` while the request said `"b1"`. No error, no warning,
no indication the write was partial.

### Controls

1. **Sending only the ungranted field** — the write becomes a complete no-op that
   still answers success:

   ```
   POST /api/tcfld:update?filterByTk=1  X-Role: tcfldr  {"beta":"b2"}
   → 200 {"data":[{"id":1,"alpha":"a1","beta":"b0"}]}
   row after: 1|a1|b0
   ```

2. **A role with no update grant at all** — refusal exists, at the action level:

   ```
   role tcvieworr: view on ["id","alpha","beta"], no update action
   POST /api/tcfld:update?filterByTk=1  X-Role: tcvieworr  {"alpha":"zzz"}
   → 403 {"errors":[{"message":"No permissions"}]}
   row after: 1|a1|b0
   ```

So the product knows how to say no. It just does not say it per-field.

### Mechanism

`packages/core/acl/src/acl.ts:120-131` — a `beforeGrantAction` hook rewrites the
grant's field list into a repository **whitelist**:

```ts
if ((actionName === 'create' || actionName === 'update') && ctx.params.fields) {
  ctx.params = {
    ...lodash.omit(ctx.params, 'fields'),
    whitelist: ctx.params.fields,
  };
}
```

A whitelist filters values on the way through; it never rejects the request that
carried the extra keys. That is the whole finding, and `findings.md` should carry
this cite.

---

## 7. `X-Role: __union__` is silently rewritten under default role mode

**VERDICT: CONFIRMED**, and the control below removes the last doubt that the
answer was "a union that happened to look like role A".

### Mechanism (cite accurate at this SHA)

`packages/plugins/@nocobase/plugin-acl/src/server/middlewares/setCurrentRole.ts:55-58`:

```ts
if ([currentRole, ctx.state.currentRole].includes(UNION_ROLE_KEY) && roleMode === SystemRoleMode.default) {
  currentRole = userRoles[0].name;
  ctx.state.currentRole = userRoles[0].name;
  ctx.headers['x-role'] = userRoles[0].name;
}
```

while every other unheld role name reaches `:74-81` and is thrown out:

```ts
role = userRoles.find((role) => role.name === currentRole)?.name;
if (!role) {
  return ctx.throw(401, { code: 'ROLE_NOT_FOUND_FOR_USER', … });
}
```

`UNION_ROLE_KEY = '__union__'` (`plugin-acl/src/server/constants.ts:10`).

### Probe — `roleMode` is `default` (verified: `select "roleMode" from "systemSettings"` → `default`)

Two-role user `tcunion` (`tcuniona` + `tcunionb`, checked in `rolesUsers`):

```
GET /api/tcmixed:list?sort=id   X-Role: tcuniona
→ 200 {"data":[{"age":23,"name":"Jack","id":1},{"age":29,"name":"Lily","id":2},{"age":27,"name":"Jade","id":3}],"meta":{"count":3,…}}

GET /api/tcmixed:list?sort=id   X-Role: __union__
→ 200 {"data":[{"age":23,"name":"Jack","id":1},{"age":29,"name":"Lily","id":2},{"age":27,"name":"Jade","id":3}],"meta":{"count":3,…}}
```

Byte-identical. The caller asked to act as the union and acted as `tcuniona`.

### Control 1 — any other unheld role name

```
GET /api/tcmixed:list?sort=id   X-Role: admin
→ 401 {"errors":[{"message":"The role does not belong to the user","code":"ROLE_NOT_FOUND_FOR_USER"}]}

GET /api/tcmixed:list?sort=id   X-Role: tcnosuchrole
→ 401 {"errors":[{"message":"The role does not belong to the user","code":"ROLE_NOT_FOUND_FOR_USER"}]}
```

### Control 2 — what a *real* union answers

Flipping the mode (`POST /api/roles:setSystemRoleMode {"roleMode":"allow-use-union"}`,
verified in `systemSettings`) and re-issuing the **same request with the same header**:

```
GET /api/tcmixed:list?sort=id   X-Role: __union__
→ 200 {"data":[{"name":"Jack","sex":"Man","id":1,"age":23},
               {"name":"Lily","sex":"Woman","id":2,"age":29},
               {"name":"Jade","sex":"Woman","id":3,"age":27},
               {"name":"James","sex":"Man","id":4,"age":31}],"meta":{"count":4,…}}
```

Four rows, `age` **and** `sex`. The default-mode answer had three rows and no
`sex` — it was `tcuniona`'s answer, not a union. A 401 would be a refusal; a 200
under a role the caller never named is a substitution.

---

## 8. F6 — "New menu items are accessible by default" is true of the seeded roles only

**VERDICT: CONFIRMED**, both halves.

### Doc

`users-permissions/acl/permissions.md:19`, fifth item under `### Configuration Permissions`:

> 5. **New menu items are allowed to be accessed by default**: Newly created menus
>    are accessible by default, and this setting is enabled by default.

### Probe — a role minted through the api

```
POST /api/roles:create {"name":"tcnm1","title":"TC New Menu 1"}
→ 200 {"data":{"default":false,"hidden":false,"snippets":["!pm","!pm.*","!ui.*"],
        "name":"tcnm1","title":"TC New Menu 1", …,
        "allowNewMenu":false,"allowNewMobileMenu":false,"allowNewAiEmployee":true,
        "description":null,"strategy":null,"allowConfigure":null}}

GET /api/roles:get?filterByTk=tcnm1
→ 200 {"data":{ …,"allowNewMenu":false, …}}
```

### Control — the two roles the installation creates

```
GET /api/roles:list?paginate=false
admin  | allowNewMenu= True  | strategy= {'actions': ['create','view','update','destroy','export','importXlsx']}
member | allowNewMenu= True  | strategy= {'actions': ['view:own']}   | default= True
root   | allowNewMenu= False | strategy= None
```

`admin` and `member` — the two roles the sentence is true of — are `true`. `root`
(hidden, the super-admin role) is `false`, which is a third data point the finding
does not mention and which does not change it.

### Mechanism

- `plugin-acl/src/server/server.ts:451` and `:458` — `allowNewMenu: true` written
  literally into the `admin` and `member` seed records. Cites accurate.
- `plugin-acl/src/server/collections/roles.ts:77-80` — the column is
  `{ type: 'boolean', name: 'allowNewMenu' }` with **no `defaultValue`** (`name` on
  `:79`). `findings.md` says `:78-81`; the block is `:77-80`. Minor stale cite.
- `plugin-acl/src/client/NewRole.tsx:46-47` — the New role drawer's `useValues`
  returns only `{ name: \`r_${uid()}\`, snippets: ['!ui.*','!pm','!pm.*'] }`. Cite
  accurate.

---

## 9. F4 — `union.md`'s mixed-merge example is wrong in both directions

**VERDICT: CONFIRMED.** Both row lists are one row short, and the second direction
(D2, which the corpus board never reached) is confirmed here too.

### Doc — `users-permissions/acl/union.md`, `#### Mixed Rows and Columns` (`:138-163`)

> Role A filter: Age < 30, columns Name, Age
>
> | UserID | Name | Age |
> | ------ | ---- | --- |
> | 1      | Jack | 23  |
> | 2      | Lily | 29  |
>
> Role B filter: Name contains "Ja", columns Name, Sex
>
> | UserID | Name  | Sex   |
> | ------ | ----- | ----- |
> | 3      | Jade  | Woman |
> | 4      | James | Man   |

and its merged table (`:156-161`) lists all four rows — `Jack 23 Man`,
`Lily 29 Woman`, `Jade 27 Woman`, `James 31 Man` — which is the fixture the
example's own data implies.

### Fixture, built to the manual exactly

```
tcmixed:  1|Jack|23|Man   2|Lily|29|Woman   3|Jade|27|Woman   4|James|31|Man
scope A:  {"$and":[{"age":{"$lt":30}}]}          role tcuniona, fields ["name","age"]
scope B:  {"$and":[{"name":{"$includes":"Ja"}}]} role tcunionb, fields ["name","sex"]
user   :  tcunion, roles ["tcuniona","tcunionb"] (exactly two, checked in rolesUsers)
```

### Probe — Role A alone

```
GET /api/tcmixed:list?sort=id   X-Role: tcuniona
→ 200 {"data":[{"age":23,"name":"Jack","id":1},
               {"age":29,"name":"Lily","id":2},
               {"age":27,"name":"Jade","id":3}],"meta":{"count":3,…}}
```

Three rows where the manual prints two. **Jade is 27, and 27 < 30.**

### Probe — Role B alone (the direction the board never reached)

```
GET /api/tcmixed:list?sort=id   X-Role: tcunionb
→ 200 {"data":[{"name":"Jack","sex":"Man","id":1},
               {"name":"Jade","sex":"Woman","id":3},
               {"name":"James","sex":"Man","id":4}],"meta":{"count":3,…}}
```

Three rows where the manual prints two. **`Jack` contains `Ja`.**

### Control — the merge itself is correct

Under `allow-use-union` the merged read returns all four rows with both `age` and
`sex` (quoted in §7 above), which is exactly the manual's merged table. The three
rules in `#### Summary` (`:167-171`) hold. The defect is confined to the two
per-role tables: they contradict the filters printed immediately above them.

---

## 10. F12 — a `view:own` role poisons the union against a collection with no `createdById`

**VERDICT: CONFIRMED**, both directions, plus a mechanism control that ties the
403 to the missing column.

### Probe — the same request, two role sets

`roleMode` set to `allow-use-union` throughout so the union really runs. `tcmixed`
was created with `collections:create`, which presets nothing, so its columns are
`id, name, age, sex` — no `createdById`.

```
roles = tcuniona+tcunionb           (two)
GET /api/tcmixed:list?sort=id  X-Role: __union__
→ 200 {"data":[4 rows with name/age/sex/id],"meta":{"count":4,…}}

POST /api/roles/member/users:add [4]      # member's strategy is {"actions":["view:own"]}
roles = member+tcuniona+tcunionb    (three)
GET /api/tcmixed:list?sort=id  X-Role: __union__     (re-signed-in, so no stale role cache)
→ 403 {"errors":[{"message":"No permissions"}]}
```

### Control 1 — removing the role restores the answer

```
POST /api/roles/member/users:remove [4]
roles = tcuniona+tcunionb
GET /api/tcmixed:list?sort=id  X-Role: __union__
→ 200 {"data":[4 rows],"meta":{"count":4,…}}
```

### Control 2 — the individual roles are unaffected

With all three roles held, `X-Role: tcuniona` still answers `200` with its three
rows. Only the *merged* action carries the poisoned filter.

### Control 3 — the mechanism, proved by removing its precondition

With the three roles still held, giving `tcmixed` a `createdById` column and
re-issuing the identical request:

```
POST /api/collections/tcmixed/fields:create {"name":"createdBy","type":"belongsTo",
      "interface":"createdBy","target":"users","foreignKey":"createdById", …}
→ 200
columns now: id, name, age, sex, createdById

GET /api/tcmixed:list?sort=id  X-Role: __union__
→ 200 {"data":[{"id":1,"name":"Jack","age":23,"sex":"Man","createdById":null}, …4 rows…],"meta":{"count":4,…}}
```

403 → 200 on the strength of one column. That is the finding's mechanism, isolated.

### Mechanism (cites accurate)

- `packages/core/acl/src/acl.ts:645-656` — `checkFilterParams(collection, filter)`;
  `throw new NoPermissionError('createdById field not found')` at **`:655`** when the
  filter mentions `createdById` and the collection has no such field.
- `packages/core/acl/src/acl.ts:482` — where the core middleware calls it.
- `packages/core/acl/src/acl.ts:528-535` — the reason is then thrown away:

  ```ts
  } catch (e) {
    if (e instanceof NoPermissionError) {
      ctx.throw(403, 'No permissions');
      return;
    }
    throw e;
  }
  ```

  Every `NoPermissionError` becomes the same opaque string, which is why the 403
  above names nothing about `createdById`.

---

## 11. F5 — the docs name a "UI Builder" button; the product's control is "UI Editor"

**VERDICT: CONFIRMED.**

### Doc

`interface-builder/index.md:5`:

> NocoBase provides a WYSIWYG UI building experience. Click the **UI Builder** button
> to toggle between Edit mode and View mode.

### Probe — the product's own copy, read off `/admin` on a fresh install

```
No pages yet, please configure first
Click the "UI Editor" icon in the upper right corner to enter the UI Editor mode
```

(That is the complete body text of the page.)

### Control — the accessible name of the control itself

```
body text contains "UI Builder":                       false
[title*="UI Builder"], [aria-label*="UI Builder"]:     0 elements
[title*="UI Editor"],  [aria-label*="UI Editor"]:      1 element
accessible names of the top-bar controls:
  ["UI Editor","highlight","setting","bell","question-circle","user"]
getByLabel("UI Builder"):  0
getByTitle("UI Editor"):   1
```

"UI Builder" appears nowhere in the rendered application.

### Mechanism

- `packages/core/client/src/schema-component/core/DesignableSwitch.tsx:44` —
  `<Tooltip title={t('UI Editor')}>`. Cite accurate.
- `packages/core/client-v2/src/flow/models/topbar/TopbarActionModel.tsx:381` —
  `tooltip = tExpr('UI Editor');`. **`findings.md` cites `:378` — stale by three lines.**

Screenshot: `shots/f5-admin-empty.png` (ephemeral, in the scratch dir).

---

## 12. F7 — the four documented route types are not the four the form offers

**VERDICT: CONFIRMED.**

### Doc

`routes/index.md:19-24`:

> The system supports four types of routes:
>
> - Group (group): Used to manage routes by grouping them, and can include sub-routes
> - Page (page): System internal page
> - Tab (tab): Used to switch between tabs in a page
> - Link (link): Internal or external link, can directly jump to the configured link address

### Probe — the Add-new drawer at `/admin/settings/routes/desktop`

Radio options, read as accessible names:

```
["Group","Classic page (v1)","Modern page (v2)","Link"]
getByRole('radio', { name: 'Page', exact: true }) → 0
```

Full drawer text, verbatim:

```
Add new
*Type:
Group
Classic page (v1)
Modern page (v2)
Link
*Title:
Icon:
Select icon
Show in menu:
Enable page tabs:
Cancel
Submit
```

`Page` is not on the form (it is two entries now), and `Tab` is not on it at all.

### Mechanism

`packages/plugins/@nocobase/plugin-client/src/client/routesTableSchema.tsx:249-258` —
cite accurate:

```tsx
<Radio.Group {...props}>
  {!isMobile && <Radio value={NocoBaseDesktopRouteType.group}>{t('Group')}</Radio>}
  <Radio value={NocoBaseDesktopRouteType.page}>
    {t(isMobile ? 'Page' : 'Classic page (v1)')}
  </Radio>
  {!isMobile && (
    <Radio value={NocoBaseDesktopRouteType.flowPage}>{t('Modern page (v2)')}</Radio>
  )}
  <Radio value={NocoBaseDesktopRouteType.link}>{t('Link')}</Radio>
</Radio.Group>
```

The `Page` label survives only on the mobile form.

Screenshot: `shots/f7-add-route-drawer.png` (ephemeral).

---

## 13. F8 / D4 — the Create-collection menu offers six of the documented types, and renames the seventh

**VERDICT: CONFIRMED**, exactly as `findings.md` records it.

### Probe — the dropdown, scoped to the open menu

At `/admin/settings/data-source-manager/main/collections?type=main`, clicking
`Create collection`:

```
General collection · Calendar collection · Tree collection · File collection · SQL collection · Connect to database view
count: 6
```

### Control — checked against every name the three manual pages use

```
PRESENT  General collection
PRESENT  Calendar collection
ABSENT   Comment collection
PRESENT  Tree collection
PRESENT  File collection
PRESENT  SQL collection
ABSENT   Connect a database view
ABSENT   Database view collection
ABSENT   Connect external data
ABSENT   Expression collection
ABSENT   Inheritance collection
```

### Doc — three enumerations, three different vocabularies

`data-sources/index.md:49-57`:

> | [General collection] | … | [Calendar collection] | … | [Comment collection] | … |
> | [Tree collection] | … | [File collection] | … | **[Connect a database view]** | … |
> | [SQL collection] | … | **[Connect external data]** | Connects remote data tables
> through database FDW technology. |

`data-sources/data-modeling/index.md:43-52`:

> | General collection | Calendar collection | **Comment collection** | Tree collection |
> | File collection | SQL collection | **Connect a database view** | **Expression
> collection** | **Connect external data** |

`data-sources/data-source-main/index.md:80-87`:

> NocoBase supports creating and managing these collection types:
> - **General collection** … - **Inheritance collection**: derives child collections
> from a parent collection … - **Tree collection** … - **Calendar collection** …
> - **File collection** … - **SQL collection** … - **Database view collection**:
> connects an existing database view.

The shipped label is **`Connect to database view`** — none of `Connect a database
view`, `Database view collection`, or `Database view`. D4 is resolved the way
`findings.md` says: all three pages are wrong about that one name.

### One correction to the finding's prose

`findings.md` F8 says upstream PR #10009 removed *"Calendar, Expression, Comment and
Connect to foreign data"* from the create menu. **`Calendar collection` is on the
menu at this SHA** — as the finding's own comparison table already shows (it lists
only Comment, Expression, Connect external data and Inheritance as absent). The
narrative sentence and the table disagree; the table is right.

Screenshot: `shots/f8-create-menu-scoped.png` (ephemeral).

---

## 14. F9 — the route manager has one endpoint, not two

**VERDICT: CONFIRMED.**

### Doc

`routes/index.md:9`:

> The route manager is a tool for managing the routes of the main page of the system,
> supporting `desktop` and `mobile` endpoints.

### Probe — `/admin/settings/routes/desktop`

```
tablist count: 0        getByRole('tab') count: 0
page contains "Desktop routes": true
page contains "Mobile routes":  false
```

`Desktop routes` is the single entry of the page's horizontal nav — it renders as
the lone selected item of an `ant-menu-horizontal` (`SPAN.ant-menu-title-content`
inside `LI.ant-menu-item.ant-menu-item-selected`), which is what the screenshot
shows as the page's one tab. There is no second entry.

A nuance worth recording: `findings.md` and `run-classification.md` describe this
as "a single tab". Structurally it is an `ant-menu` item, not an `ant-tabs` tab —
`getByRole('tab')` finds nothing on this page at all. The substance is unchanged;
a scenario addressing it by tab role would fail for the wrong reason.

### Control — the plugin really is on

```
select name, enabled, "builtIn" from "applicationPlugins" where name like '%mobile%'
→ mobile | t | t
```

Enabled and built-in on a stock install, so its absence from the route manager is
not a disabled-plugin artefact.

### Mechanism

`packages/plugins/@nocobase/plugin-mobile/src/client/index.tsx:274` — cite accurate.
The only `Mobile routes` label in the tree is a tab **inside the ACL permission
drawer**, produced by `addPermissionsSettingsUI()` (`:262`, called at `:121`):

```tsx
return {
  key: 'mobile-menu',
  label: t('Mobile routes', { ns: pkg.name }),
  sort: 25,
  children: ( <TabLayout> … <MenuPermissions … /> </TabLayout> ),
};
```

Screenshot: `shots/f9-routes-page.png` (ephemeral).

---

## 15. SURFACE — the Add-route drawer's `Title` input has no accessible name

**VERDICT: CONFIRMED**, and the accessibility evidence is unambiguous.

### Probe — the input's own markup

```html
<input class="ant-input css-17h1pxo" type="text" value="">
```

No `id`, no `name`, no `aria-label`, no `aria-labelledby`, no `placeholder`. The
DOM's own label association is empty:

```
element.labels.length → 0
```

The visible label renders as `*Title:` in the drawer text but is not tied to the
control.

### Control — accessible-name resolution

`getByRole` applies the accname algorithm, so it is the decisive test:

```
getByRole('textbox')                          → 1     (the input is reachable by role)
getByRole('textbox', { name: 'Title' })       → 0
getByRole('textbox', { name: 'Title：' })      → 0
getByRole('textbox', { name: /Title/ })       → 0
```

The control exists; it has no name.

### A caveat for anyone re-running this

On the newer Playwright used here (`playwright-core` 1.62.1), `getByLabel('Title')`
returns **1** — which looks at first like a refutation. It is not: that match is not
the input, and using it fails —

```
getByLabel('Title')              → 1
getByLabel('Title', {exact:true})→ 0
locator.fill(...) via getByLabel → Error: Element is not an <input>, <textarea>,
                                   <select> or [contenteditable] …
```

`getByLabel` matched the label/form-item wrapper, not the control. So a scenario
that must **type** into this field still has no expression in the locator
vocabulary, exactly as `run-classification.md` §8 item 3 states. The half-finding
stands; only the probe used to demonstrate it needs to be `getByRole(... {name})`
rather than `getByLabel`.

Screenshot: `shots/surface-title-filled.png` (ephemeral).

---

## Stale citations found

| finding | cite in `findings.md` | actual at this SHA |
| --- | --- | --- |
| F5 | `client-v2/src/flow/models/topbar/TopbarActionModel.tsx:378` | **`:381`** |
| F6 | `plugin-acl/src/server/collections/roles.ts:78-81` | the `allowNewMenu` column object is **`:77-80`** (`name` on `:79`) |

Every other citation checked in this pass is exact: `gateway/index.ts:706-725`,
`application.ts:1031-1039`, `setCurrentRole.ts:55-58`, `constants.ts:10`,
`acl.ts:645/:655`, `server.ts:451,:458`, `NewRole.tsx:46-48`,
`DesignableSwitch.tsx:44`, `routesTableSchema.tsx:249-258`,
`plugin-mobile/src/client/index.tsx:274`, `properties/index.ts:28`.

### Cites this pass adds (findings.md carries none for these)

| finding | mechanism |
| --- | --- |
| F13 | `packages/core/acl/src/acl.ts:120-131` — the grant's `fields` becomes a repository **whitelist** on `create`/`update`, which filters rather than refuses |
| F11.1 | `packages/core/actions/src/utils.ts:26-39` (`getRepositoryFromParams` returns `undefined`) + `packages/core/actions/src/actions/list.ts:37` (`repository.collection?.options` — the optional chain guards one level too deep) |
| F11.2 | `packages/core/database/src/database.ts:779` — `throw Error(\`unsupported field type ${type}\`)`, an untyped `Error`, hence 500 |

---

## Teardown

Everything created for this verification, and its disposal:

| created | disposed |
| --- | --- |
| compose project **`tcverify-nocobase`** — container `tcverify-nocobase-postgres-1`, its anonymous volume, its network, port 127.0.0.1:15532 | `docker compose -p tcverify-nocobase down -v` — container, volume and network removed |
| NocoBase server processes on port **14100** (`nocobase-v1 start …` / `…/app/lib/index.js start …`) | killed by process group, then swept with `pkill -f 'nocobase-v1 start'` and `pkill -f 'app/lib/index.js start'`; verified with `pgrep -f` (0) and `lsof -nP -iTCP:14100` (nothing listening) |
| scratch dir `…/scratchpad/nocobase-verify/` (env files, launch/stop helpers, logs, DB snapshots, screenshots) | left in the session scratchpad, which is ephemeral. The decisive DOM text from every screenshot is inlined above, so this report stands alone. |
| `/tmp/tcv/` (short-path gateway socket + PM2 home) | removed |

Untouched, and verified untouched:

- compose project **`tc-nocobase`** and its container `tc-nocobase-postgres-1` —
  never started, never connected to, still `Exited (0)`.
- containers `database`, `redis`, `caldiy-calcom-1` and every other project on this
  host.
- the repo's `storage/` directory — this run used a scratch `STORAGE_PATH`.
- `yarn.lock` and all product source — `git status` shows only `?? .truecourse/` and
  `?? reference/`, as at the start.
- GitHub — nothing was queried, created, or commented on.
