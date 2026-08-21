---
finding: UNION-REWRITE
target: nocobase/nocobase
route: public issue
title: "Under the default role mode, X-Role: __union__ is silently rewritten to the user's first role instead of being refused like every other unheld role name"
labels: "none (bug_report.md sets no labels; suggested in body: bug, users & permissions)"
status: filed
filed_url: https://github.com/nocobase/nocobase/issues/10399
filed_at: 2026-08-21
reverified: "yes (main @ 032a4f6913be912f57462d605cbd0bde97b599c6, `yarn nocobase --version` -> 2.1.45; live re-run 2026-08-20 on an instance built from that commit, with all three controls re-driven and the roleMode read out of systemSettings before and after: still reproduces)"
format_note: "Matches .github/ISSUE_TEMPLATE/bug_report.md exactly, including the leading asterisk on the three required sections (`## * Describe the bug`, `## * Environment`, `## * How To Reproduce`) and the optional `Expected behavior` / `Screenshots` / `Logs`. Own sub-headings demoted to ####. No template-enforcing workflow was detected on this repo, but the template itself warns that issues not filled out according to it will be closed, so the shape is matched anyway. English only, per the template's note. Filed as a normal bug, NOT as a security report: the substituted role is always one the caller already holds, so effective permissions are a subset of what was asked for, never more."
---

# Under the default role mode, X-Role: __union__ is silently rewritten to the user's first role instead of being refused like every other unheld role name

## * Describe the bug

The ACL middleware refuses every role name a user does not hold, with a `401` and a specific code:

```
GET /api/tcunionmixed:list?sort=id   X-Role: tcnosuchrole
-> 401 {"errors":[{"message":"The role does not belong to the user","code":"ROLE_NOT_FOUND_FOR_USER"}]}
```

There is exactly one exception. Under the **default** role mode, `X-Role: __union__` is not refused. It is quietly rewritten to `userRoles[0].name`, and the request runs as that role and answers `200`. The response carries nothing to say a substitution happened, so a caller who asked to act as the union of their roles is told, in every observable way, that it worked.

**This is not a privilege escalation report and should not be read as one.** `userRoles[0]` is always a role the caller already holds, so the effective permissions of the substituted request are a subset of what the caller asked for, never a superset. Nothing is leaked and no boundary is crossed. The defect is the silent substitution itself: the same middleware, four lines further down, refuses every other name it cannot honour, and the caller has no way to learn that the answer in their hands came from a different role than the one they named.

The practical cost is that a client cannot tell "the union" from "one of your roles". Under the default mode a script that sends `__union__` receives one role's rows and treats them as the union's rows, and no error is raised at any layer.

#### Three controls, and each removes a different objection

**Control 1: the answer is byte-identical to naming the first role explicitly.**

```
GET /api/tcunionmixed:list?sort=id   X-Role: tcuniona
-> 200 {"data":[{"age":23,"name":"Jack","id":1},{"age":29,"name":"Lily","id":2},{"age":27,"name":"Jade","id":3}],"meta":{"count":3,"page":1,"pageSize":20,"totalPage":1}}

GET /api/tcunionmixed:list?sort=id   X-Role: __union__
-> 200 {"data":[{"age":23,"name":"Jack","id":1},{"age":29,"name":"Lily","id":2},{"age":27,"name":"Jade","id":3}],"meta":{"count":3,"page":1,"pageSize":20,"totalPage":1}}
```

Compared as raw text, the two response bodies are equal.

**Control 2: the server itself reports the substituted role.**

```
GET /api/roles:check   X-Role: __union__   -> data.role = "tcuniona"
GET /api/roles:check   X-Role: tcuniona    -> data.role = "tcuniona"
```

So this is not an inference from the row set. The product's own endpoint for "which role am I acting as" answers `tcuniona` for a request that named `__union__`.

**Control 3: a real union looks different, so the default-mode answer was not a union that happened to match.** Flip the system role mode and re-issue the same request with the same header:

```
POST /api/roles:setSystemRoleMode {"roleMode":"allow-use-union"}  -> 200

GET /api/tcunionmixed:list?sort=id   X-Role: __union__
-> 200 {"data":[{"name":"Jack","sex":"Man","id":1,"age":23},
                {"name":"Lily","sex":"Woman","id":2,"age":29},
                {"name":"Jade","sex":"Woman","id":3,"age":27},
                {"name":"James","sex":"Man","id":4,"age":31}],"meta":{"count":4,...}}
```

Four rows, and both `age` and `sex`. The default-mode answer had three rows and no `sex`, so it was one role's answer and not a union. This is the control that matters, because without it a reader can reasonably say the 200 *was* the union.

#### Cause

`packages/plugins/@nocobase/plugin-acl/src/server/middlewares/setCurrentRole.ts:55-58`:

```ts
if ([currentRole, ctx.state.currentRole].includes(UNION_ROLE_KEY) && roleMode === SystemRoleMode.default) {
  currentRole = userRoles[0].name;
  ctx.state.currentRole = userRoles[0].name;
  ctx.headers['x-role'] = userRoles[0].name;
}
```

https://github.com/nocobase/nocobase/blob/032a4f6913be912f57462d605cbd0bde97b599c6/packages/plugins/@nocobase/plugin-acl/src/server/middlewares/setCurrentRole.ts#L55-L58

Note that the incoming request header is rewritten too, so downstream code cannot see what the caller actually sent.

Every other unheld name falls through to `:74-81` and is thrown out:

```ts
role = userRoles.find((role) => role.name === currentRole)?.name;
if (!role) {
  return ctx.throw(401, { code: 'ROLE_NOT_FOUND_FOR_USER', ... });
}
```

`UNION_ROLE_KEY` is `'__union__'` (`packages/plugins/@nocobase/plugin-acl/src/server/constants.ts:10`). The two branches sit in the same file, twenty lines apart, and treat the same class of input in opposite ways.

## * Environment

- NocoBase version: **2.1.45** (`yarn nocobase --version`), built from `main` at commit `032a4f6913be912f57462d605cbd0bde97b599c6`
- Database type and version: **PostgreSQL 16** (official image, in Docker, published on 127.0.0.1)
- OS: **macOS** (Darwin 25.5.0, arm64)
- Deployment Methods: **Git source code** (`yarn install --frozen-lockfile`, then `yarn build`, then `yarn nocobase start --launch-mode node` with `APP_PORT=14100` and `APP_HOST=127.0.0.1`)
- Docker image version: not applicable, this is a source build
- NodeJS version: **v20.19.5** (yarn 1.22.22)

Stock install. The system role mode was the installed default: `select "roleMode" from "systemSettings"` returns `default`.

## * How To Reproduce

All values below are verbatim from one run on an instance built from the commit above.

**1. A collection with four rows.** Collection `tcunionmixed`, columns `name`, `age`, `sex`:

```
1|Jack|23|Man
2|Lily|29|Woman
3|Jade|27|Woman
4|James|31|Man
```

**2. Two roles, each with its own row filter and column set.**

- `tcuniona`: `view` scoped `{"$and":[{"age":{"$lt":30}}]}`, fields `["name","age"]`
- `tcunionb`: `view` scoped `{"$and":[{"name":{"$includes":"Ja"}}]}`, fields `["name","sex"]`

**3. One user holding exactly those two roles.** User `tcunion`; checked in the database so the result cannot be blamed on a third implicit role, `rolesUsers` holds `tcuniona` and `tcunionb` for this user and nothing else. Sign in as this user for every request below.

**4. Confirm the mode.**

```
select "roleMode" from "systemSettings";
-> default
```

**5. Read as the first role, then read as the union. This is the bug.**

```
GET /api/tcunionmixed:list?sort=id   X-Role: tcuniona
-> 200 {"data":[{"age":23,"name":"Jack","id":1},{"age":29,"name":"Lily","id":2},{"age":27,"name":"Jade","id":3}],"meta":{"count":3,"page":1,"pageSize":20,"totalPage":1}}

GET /api/tcunionmixed:list?sort=id   X-Role: __union__
-> 200 {"data":[{"age":23,"name":"Jack","id":1},{"age":29,"name":"Lily","id":2},{"age":27,"name":"Jade","id":3}],"meta":{"count":3,"page":1,"pageSize":20,"totalPage":1}}
```

The two raw response texts compare equal.

**6. Ask the server which role it used.**

```
GET /api/roles:check   X-Role: __union__   -> data.role = "tcuniona"
GET /api/roles:check   X-Role: tcuniona    -> data.role = "tcuniona"
```

**7. Control, every other unheld name.** `admin` exists but this user does not hold it; `tcnosuchrole` does not exist at all. Both are refused:

```
GET /api/tcunionmixed:list?sort=id   X-Role: admin
-> 401 {"errors":[{"message":"The role does not belong to the user","code":"ROLE_NOT_FOUND_FOR_USER"}]}

GET /api/tcunionmixed:list?sort=id   X-Role: tcnosuchrole
-> 401 {"errors":[{"message":"The role does not belong to the user","code":"ROLE_NOT_FOUND_FOR_USER"}]}
```

`__union__` is the only unheld name that does not get this treatment.

**8. Control, what a genuine union answers.** Flip the mode, verify it in the database, and send the same request with the same header:

```
POST /api/roles:setSystemRoleMode {"roleMode":"allow-use-union"}   -> 200
select "roleMode" from "systemSettings";   -> allow-use-union

GET /api/tcunionmixed:list?sort=id   X-Role: __union__
-> 200 {"data":[{"name":"Jack","sex":"Man","id":1,"age":23},
                {"name":"Lily","sex":"Woman","id":2,"age":29},
                {"name":"Jade","sex":"Woman","id":3,"age":27},
                {"name":"James","sex":"Man","id":4,"age":31}],"meta":{"count":4,...}}
```

Four rows and an extra column, from the same request that returned three rows and no `sex` a moment earlier.

## Expected behavior

`X-Role: __union__` under the default role mode should be answered the way every other role the caller cannot use is answered:

```
401 {"errors":[{"message":"The role does not belong to the user","code":"ROLE_NOT_FOUND_FOR_USER"}]}
```

or a `400` with a code of its own, for example that the union role is not available under the current system role mode. Either is fine. What matters is that the caller learns the request was not honoured as asked, instead of receiving a `200` produced under a role it never named.

If degrading to the first role is a deliberate compatibility behaviour, then two things should follow. The response should carry a signal that the substitution happened, so a client can react to it, and the role-mode documentation should state plainly that under the default mode `__union__` resolves to the user's first role rather than to a union. Today neither is true, and the request header is rewritten in place at `setCurrentRole.ts:57`, so even server-side code downstream cannot tell what the caller sent.

One more note on scope, because it decides how this should be triaged: this is a correctness and observability bug, not a security one. The substituted role is one the caller holds, and its permissions are a subset of the union that was requested.

## Screenshots

Not applicable. The finding is entirely in the HTTP responses quoted above, together with the two `roleMode` readings taken from PostgreSQL.

## Logs

There is no error log to attach, and that is part of the report. The request never reaches an error path: the middleware rewrites the role and the action then runs normally, so nothing is logged as a failure at any layer. The record of what happened is the pair of byte-identical response bodies, the `roles:check` answer naming `tcuniona`, and the different result the same header produces under `allow-use-union`, all quoted above.

#### Suggested labels

`bug`, `users & permissions` (our account cannot apply labels itself).

#### Related

We searched the tracker for `__union__` and for recently created items before filing. The union-related pull requests we found are unrelated code fixes that predate the commit tested here and do not touch this branch: one preserving union default role members, one on the union role variable in v2, and one on role-union delete with root. If there is an existing report we missed, please close this as a duplicate.

Found by TrueCourse running the product's published documentation against a live instance; the full transcript (requests, both raw response texts compared byte for byte, and the `roleMode` readings before and after the flip) is available on request.
