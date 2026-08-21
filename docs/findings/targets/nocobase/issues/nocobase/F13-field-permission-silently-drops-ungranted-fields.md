---
finding: F13
target: nocobase/nocobase
route: public issue
title: "Field permissions: an update naming a field outside the role's Edit grant answers 200 and silently discards the value"
labels: "none (bug_report.md sets no labels; suggested in body: bug, users & permissions)"
status: filed
filed_url: https://github.com/nocobase/nocobase/issues/10396
filed_at: 2026-08-20
format_note: "Matches .github/ISSUE_TEMPLATE/bug_report.md exactly, including the leading asterisk on the three required sections (`## * Describe the bug`, `## * Environment`, `## * How To Reproduce`) and the optional `Expected behavior` / `Screenshots` / `Logs`. Own sub-headings demoted to ####. No template-enforcing workflow was detected on this repo, but the template itself warns that issues not filled out according to it will be closed, so the shape is matched anyway. English only, per the template's note."
reverified: "yes (main @ 032a4f6913be912f57462d605cbd0bde97b599c6, `yarn nocobase --version` -> 2.1.45; live re-run 2026-08-20 on a clean instance built from that commit: still reproduces)"
---

# Field permissions: an update naming a field outside the role's Edit grant answers 200 and silently discards the value

## * Describe the bug

When a role's Edit permission is scoped to a subset of a collection's fields, an update that names a field outside that subset is not refused. The ungranted value is stripped, the granted fields are written, and the request answers `200` with a success body. Nothing in the response says that part of the write was thrown away: no error, no warning, no partial-success flag.

**This is not a privilege escalation report, and it should not be read as one.** The ungranted value is correctly not written. Nothing leaks, nothing is over-written, and no permission boundary is crossed. The defect is on the other side of the same coin: a caller who sends `{alpha, beta}` and receives `200` has no way to learn that only `alpha` was saved. A form, a script, or an integration that posts a whole record will report success to its user while the record on disk is only partly what was submitted, and the two diverge silently from then on.

#### The control, which is the argument

The same product, the same endpoint, the same row: a role that has **no** update grant at all is refused properly.

```
POST /api/tcfld:update?filterByTk=1   X-Role: tcvieworr   {"alpha":"zzz"}
-> 403 {"errors":[{"message":"No permissions"}]}
```

So refusal exists and works. It is only missing one level down. The silence is specific to a **partial** grant: a role that may not update at all gets a 403, and a role that may update some fields but not the one named gets a 200 and a quietly discarded value.

#### What the docs promise

`docs/docs/en/users-permissions/acl/permissions.md:41`:

> **Field Permissions**: Field permissions enable you to set specific permissions for each field during different operations. For instance, certain fields can be configured to be view-only, without editing privileges.

Field permissions are described as permissions. A denied permission is expected to produce a refusal, the way the action-level one does.

#### Cause

`packages/core/acl/src/acl.ts:120-131`, a `beforeGrantAction` hook that rewrites the grant's field list into a repository **whitelist**:

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

https://github.com/nocobase/nocobase/blob/032a4f6913be912f57462d605cbd0bde97b599c6/packages/core/acl/src/acl.ts#L120-L131

A whitelist filters values on the way through. It never rejects the request that carried the extra keys, so the ACL layer has no failure to report and the action completes normally. That is the whole finding. The same hook covers `create`, so a create naming ungranted fields takes the same path.

## * Environment

- NocoBase version: **2.1.45** (`yarn nocobase --version`), built from `main` at commit `032a4f6913be912f57462d605cbd0bde97b599c6`
- Database type and version: **PostgreSQL 16** (official image, in Docker, published on 127.0.0.1)
- OS: **macOS** (Darwin 25.5.0, arm64)
- Deployment Methods: **Git source code** (`yarn install --frozen-lockfile`, then `yarn build`, then `yarn nocobase start --launch-mode node` with `APP_PORT=14100` and `APP_HOST=127.0.0.1`)
- Docker image version: not applicable, this is a source build
- NodeJS version: **v20.19.5** (yarn 1.22.22)

Stock install, no extra plugins enabled.

## * How To Reproduce

Everything below is verbatim from one run on a clean instance built from the commit above. Values are the real ones from that run.

**1. A collection with two fields and one row.**

```
POST /api/collections:create
{"name":"tcfld","title":"TC Fields","template":"general"}

POST /api/collections/tcfld/fields:create
{"name":"alpha","type":"string","interface":"input"}

POST /api/collections/tcfld/fields:create
{"name":"beta","type":"string","interface":"input"}

POST /api/tcfld:create
{"alpha":"a0","beta":"b0"}
-> 200 {"data":{"id":1,"alpha":"a0","beta":"b0"}}
```

**2. A role whose Edit grant covers only `alpha`.** This is the API equivalent of opening Roles & Permissions, ticking View for `id`, `alpha`, `beta` and ticking Edit for `alpha` alone:

```
POST /api/roles:create
{"name":"tcfldr","title":"TC Field Role","snippets":["!ui.*","!pm","!pm.*"]}

POST /api/roles/tcfldr/dataSourceResources:create
{"name":"tcfld","dataSourceKey":"main","usingActionsConfig":true,
 "actions":[{"name":"view","fields":["id","alpha","beta"]},
            {"name":"update","fields":["alpha"]}]}
```

**3. A user holding exactly that one role**, then sign in as them:

```
POST /api/users:create
{"username":"tcflduser","password":"…","nickname":"TC Field User","roles":["tcfldr"]}
```

Checked in the database so the result cannot be blamed on a second implicit role: `rolesUsers` holds one row for this user, `tcflduser|tcfldr`.

**4. Update both fields as that user.** This is the whole bug:

```
row before (read straight from postgres):  1|a0|b0

POST /api/tcfld:update?filterByTk=1
  Authorization: Bearer <tcflduser token>
  X-Role: tcfldr
  Content-Type: application/json
  {"alpha":"a1","beta":"b1"}

-> 200 {"data":[{"id":1,"alpha":"a1","beta":"b0"}]}

row after (read straight from postgres):   1|a1|b0
```

`200`. `alpha` was written, `beta` was dropped. The response body is its own proof: the request carried `"beta":"b1"` and the answer returns `"beta":"b0"`.

**5. Control A, sending only the ungranted field.** The write becomes a complete no-op that still reports success:

```
POST /api/tcfld:update?filterByTk=1   X-Role: tcfldr   {"beta":"b2"}
-> 200 {"data":[{"id":1,"alpha":"a1","beta":"b0"}]}

row after: 1|a1|b0
```

**6. Control B, a role with no update grant at all.** Create a second role `tcvieworr` with `view` on `["id","alpha","beta"]` and no `update` action, give it its own user, and send the same shape of request:

```
POST /api/tcfld:update?filterByTk=1   X-Role: tcvieworr   {"alpha":"zzz"}
-> 403 {"errors":[{"message":"No permissions"}]}

row after: 1|a1|b0
```

## Expected behavior

A caller should be able to tell that their write was not applied in full. In preference order:

1. **Refuse the request.** When an update or create names a field the role's grant does not cover, answer `403` (or `400`) and name the offending fields, the way the action-level check already answers `403 No permissions`. This makes field permissions behave like the permissions the handbook says they are, and it is a small change at the same hook: validate `ctx.params.values` against the grant's field list before converting it into a whitelist.

2. **Or report the partial write.** If silently filtering is deliberate, say so in the response, for example by returning the list of discarded fields alongside the data, so a client can surface it. A `200` with no signal at all is the part that cannot be worked around by a caller.

Whichever is chosen, the handbook page above should describe it, since today it describes field permissions in terms that imply refusal.

## Screenshots

Not applicable. The finding is entirely in the HTTP request and response bodies quoted above, and the decisive value (`"beta":"b0"` returned for a request that sent `"beta":"b1"`) is inline.

## Logs

There is no error log to attach, and that is part of the report: the request never reaches an error path. The ACL layer converts the grant into a repository whitelist, the repository filters the values, and the action completes normally with `200`, so nothing is logged as a failure at any layer. The record of what happened is the response body and the row read back from PostgreSQL, both quoted above.

#### Suggested labels

`bug`, `users & permissions` (our account cannot apply labels itself).

#### Related

We searched the tracker for existing reports of this behaviour, including a sweep of recently created issues, and found nothing covering it. If there is an existing report we missed, please close this as a duplicate.

Found by TrueCourse running the product's published documentation against a live instance; the full transcript (requests, responses, and the database rows read back after each step) is available on request.
