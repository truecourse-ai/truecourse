# F13 — a field outside the Edit grant is silently discarded, not refused

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, lerna `2.1.45`, `yarn nocobase --version` → `2.1.45`) |
| built by | `yarn install --frozen-lockfile` (291s, exit 0) then `yarn build` (505s, exit 0), node v20.19.5, yarn 1.22.22 |
| instance | `yarn nocobase start --launch-mode node`, `APP_PORT=14100`, `APP_HOST=127.0.0.1`; PostgreSQL 16 from `reference/seed/compose.yml` (project `tc-nocobase`, 127.0.0.1:15432); stock install by `reference/seed/guard-seed.mjs` |
| scenario | `field-permissions-decide-which-fields-a-role-may-read-and-write.api.1`, failing step 17 |
| **verdict** | **still reproduces** |

## Fixture, built by hand through the product's own api

- collection `tcfld`, fields `alpha` and `beta` (`fields:list` → `beta,alpha`), one row `{id:1, alpha:"a0", beta:"b0"}`
- role `tcfldr`, one individual grant on `tcfld` with `usingActionsConfig: true`:
  - `view` on `["id","alpha","beta"]`
  - `update` on **`["alpha"]` only**
- role `tcvieworr`, the control: `view` on `["id","alpha","beta"]` and **no `update` action at all**
- users `tcflduser` (roles `["tcfldr"]`) and `tcviewuser` (roles `["tcvieworr"]`), each holding exactly one role. Read back from postgres:

```
rolesUsers:  tcflduser|tcfldr
             tcviewuser|tcvieworr
```

## Probe

```
row before (raw postgres):  1|a0|b0

POST /api/tcfld:update?filterByTk=1
  X-Role: tcfldr
  Content-Type: application/json
  {"alpha":"a1","beta":"b1"}

→ 200 {"data":[{"id":1,"alpha":"a1","beta":"b0"}]}

row after (raw postgres):   1|a1|b0
```

200. `alpha` written, `beta` silently dropped. The response body says so itself: the
request carried `"beta":"b1"` and the answer returns `"beta":"b0"`. No error, no
warning, no indication the write was partial.

## Control 1 — sending only the ungranted field

```
POST /api/tcfld:update?filterByTk=1   X-Role: tcfldr   {"beta":"b2"}
→ 200 {"data":[{"id":1,"alpha":"a1","beta":"b0"}]}

row after (raw postgres):   1|a1|b0
```

A complete no-op that still answers success.

## Control 2 (the essential one) — a role with no update grant at all

```
POST /api/tcfld:update?filterByTk=1   X-Role: tcvieworr   {"alpha":"zzz"}
→ 403 {"errors":[{"message":"No permissions"}]}

row after (raw postgres):   1|a1|b0
```

Refusal exists, at the action level. The silence is specific to a **partial** grant:
the same product that answers 403 when the role may not update at all answers 200 and
drops the value when the role may update some fields but not the one named.

## Mechanism (re-read at this SHA, unchanged)

`packages/core/acl/src/acl.ts:120-131` — a `beforeGrantAction` hook rewrites the grant's
field list into a repository **whitelist**:

```ts
this.beforeGrantAction((ctx) => {
  const actionName = this.resolveActionAlias(ctx.actionName);

  if (lodash.isPlainObject(ctx.params)) {
    if ((actionName === 'create' || actionName === 'update') && ctx.params.fields) {
      ctx.params = {
        ...lodash.omit(ctx.params, 'fields'),
        whitelist: ctx.params.fields,
      };
    }
  }
});
```

A whitelist filters values on the way through; it never rejects the request that carried
the extra keys.

## Raw captures

- `raw/F13.json` — the full request/response transcript plus the postgres row after every step
- `raw/probe.stdout.txt` — the probe script's console output
