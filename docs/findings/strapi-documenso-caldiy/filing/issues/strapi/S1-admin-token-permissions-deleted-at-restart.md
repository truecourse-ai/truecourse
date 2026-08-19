---
finding: S1
target: strapi/strapi
route: public issue
title: Admin token permissions on localized content types are deleted at every server restart
labels: none (BUG_REPORT.yml applies no automatic labels)
status: filed
filed_url: https://github.com/strapi/strapi/issues/27418
superseded: https://github.com/strapi/strapi/issues/27417 (auto-closed on template format before triage; refiled as 27418)
filed_at: 2026-08-19
reverified: yes (develop c7dbadd4fe / 5.52.1, 2026-08-19)
format_note: Body follows strapi/strapi BUG_REPORT.yml exactly (### section headers matching each field label + the two required checked checkboxes). The repo's Check Required Checkboxes workflow parses these headers; a table or custom headings gets auto-flagged and closed.
---

### Node Version

24.14.1

### Package Manager

yarn

### Package Manager Version

4.12.0

### Strapi Version

5.52.1

### Operating System

MacOS

### Database

SQLite

### Javascript or Typescript

Javascript

### Bug Description

Refiled from #27417, which the template checker auto-closed before triage because the original body used a table instead of this form's sections. Same finding, correctly formatted here; #27417 can be closed as a duplicate.

The Admin tokens documentation names exactly one way a token loses a permission: removing that permission from the owner's role. In practice, a permission granted through `POST /admin/admin-tokens` (or `PUT /admin/admin-tokens/:id`) on a localized content type is deleted from the database by the boot-time permission cleanup at the next server start. The token keeps authenticating and can do nothing. Nothing is logged, and the admin panel simply shows the checkbox unchecked. This hits programmatic callers, which is the audience Admin tokens exist for: the panel always sends an explicit `properties.fields` array, so panel-created permissions survive, while a permission created through the API without `properties` does not.

#### What the docs say

From https://docs.strapi.io/cms/features/admin-tokens (Configuration):

> Admin tokens are configured entirely from the admin panel. No code-based configuration is specific to Admin tokens.

and from the same page (Managing Admin tokens):

> Removing a permission from a role causes Admin tokens owned by users of that role to have the corresponding permission deleted automatically.

That sentence reads as the exhaustive list of ways a grant disappears. A restart is not on it.

#### Observed

Run on 2026-08-19 against `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, instance reporting Strapi 5.52.1:

- `GET /admin/admin-tokens/5` before the restart: `data.adminPermissions` holds one row, `{"id":364,"action":"plugin::content-manager.explorer.read","subject":"api::article.article","properties":{},"conditions":[],"locale":null}`.
- `GET /admin/admin-tokens/5` after a plain restart, with nothing else changed: `"adminPermissions": []`.
- The same MCP `tools/list` call answered `["list_article","get_article"]` before the restart and `{"tools":[]}` after it.
- The token still authenticates: `tools/call list_article` answers `isError: true`, `MCP error -32602: Tool list_article disabled`, not an authentication error. So the ability is not being derived differently, the `admin::permission` row is gone.
- The restarted server's log carries no warning, error or notice about the deletion.

### Steps to Reproduce

Build tested: `strapi/strapi` `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19), run from source with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`. The instance reports 5.52.1 on node v24.14.1. The original run of this reproduction was on 5.52.0 @ `c43e9ee1e2`.

The subject content type must be localized (i18n enabled on it). `api::article.article` in `examples/getstarted` is. A non-localized type does not reproduce, see Additional information.

The MCP server is not required. Steps 4 and 6 below are only the most legible readout of the ability.

1. Create an Admin token with one content-type permission and no `properties`:

```
POST /admin/admin-tokens
Authorization: Bearer <super-admin jwt>
Content-Type: application/json

{"name":"restart-test","description":"restart test","lifespan":null,
 "adminPermissions":[{"action":"plugin::content-manager.explorer.read",
                      "subject":"api::article.article"}]}
```

`201 Created`. The response carries `data.id` (5 in this run) and:

```json
"adminPermissions": [
  {"id":364,"documentId":"thjday34nbyyodq8v8edot4y",
   "action":"plugin::content-manager.explorer.read",
   "actionParameters":{},"subject":"api::article.article",
   "properties":{},"conditions":[],"locale":null}
]
```

`properties: {}` is what the route stores when the caller omits `properties.fields`.

2. Optional, and the route the panel's token form posts to. Re-send the same grant:

```
PUT /admin/admin-tokens/5
Authorization: Bearer <super-admin jwt>

{"adminPermissions":[{"action":"plugin::content-manager.explorer.read",
                      "subject":"api::article.article"}]}
```

`200 OK`, permission id 364 echoed back unchanged.

3. `GET /admin/admin-tokens/5` with the super-admin jwt. `200 OK`, `data.adminPermissions` holds the one row.

4. Optional control that the grant is live:

```
POST /mcp
Authorization: Bearer <admin token accessKey>
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

`200 OK`, tools `["list_article","get_article"]`.

5. Stop the server and start it again with the identical command. Change nothing else: no config edit, no permission edit, no token edit.

6. Repeat step 4 with the same token. `200 OK`, `{"result":{"tools":[]},"jsonrpc":"2.0","id":2}`.

7. Repeat step 3. `200 OK` with `"adminPermissions": []`.

Re-verified on `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (Strapi 5.52.1) on 2026-08-19: still reproduces, symptom, mechanism and silence unchanged from the 5.52.0 run.

### Expected Behavior

An Admin token permission created through the Admin API survives a server restart. The documented ways a token loses a permission are the owner's role losing it, the owner's account being deleted, or the token being edited or deleted. A process restart is not one of them, and if the boot cleanup does decide a stored permission is invalid it should not delete it silently.

### Additional information

#### Cause

`packages/core/admin/server/src/bootstrap.ts:203` calls `permissionService.cleanPermissionsInDatabase()` on every boot. That function pages through `admin::permission` and asks `filterPermissionsToRemove` which rows are stale: https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/admin/server/src/services/permission/queries.ts#L90-L123

A row is removed when its action is unregistered, its subject is outside the action's subject list, or every property in the action's `options.applyToProperties` is nil on the row (`hasInvalidProperties`, line 113, consumed by the removal condition at line 117). `plugin::content-manager.explorer.read` declares `applyToProperties: ['fields']` (`packages/core/content-manager/server/src/services/permission.ts:41-48`), and the i18n plugin appends `'locales'` to every contentTypes-section action (`packages/plugins/i18n/server/src/services/permissions/actions.ts:42-62`). The Admin token API stores its permissions with `properties: {}` and never backfills `fields` or `locales` (`packages/core/admin/server/src/services/api-token.ts:255-378`), which is deliberate: at creation a nil `fields` set means "all fields" (see the ceiling comment at `api-token.ts:265-268`). On a localized content type both applicable properties are nil, `hasInvalidProperties` is true, and `deleteByIds` at line 180 removes the row. On a non-localized type the `locales` check returns false, not every applicable property is nil, and the row survives by accident.

PR #25657 (`feat(admin): api token supports admin permissions and admin user ownership`, commit `52b8fd9e3d`, merged 2026-04-29) taught the same function about token-owned rows in its other branch: the orphan filter at lines 141-149 populates `['role','apiToken']` and deliberately keeps rows that have an `apiToken` and no `role`, with a unit test at `services/__tests__/permission.test.ts:189-260`. It left `filterPermissionsToRemove` written for role permissions only. The nil-property rule itself is much older (present in `queries.js` from `d44a6f68ee`, 2021-08-02, moved to TypeScript by `728d614ca4`, #18232). Old rule, new interaction: the rule is correct for role permissions, because the panel always writes an explicit `properties.fields` for content-type actions, and only becomes destructive once the Admin token API starts writing content-type permissions with empty properties.

Today's head still has it, byte-identical: https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/admin/server/src/services/permission/queries.ts#L90-L123 . No commit between `c43e9ee1e2` and `c7dbadd4fe` touches `queries.ts`, `bootstrap.ts`, `api-token.ts`, the content-manager permission service or the i18n actions.

The smallest correct fix looks like skipping the nil-property rule for `apiToken`-owned permissions in `filterPermissionsToRemove`, mirroring the orphan branch that already special-cases them. Backfilling `properties` at write time in `createApiTokenAdminPermissions` is the alternative.

One related inconsistency, worth a look in the same pass: nil properties mean three different things in three code paths. At creation nil `fields` means "all fields" (`api-token.ts:265-268`, and the MCP tool output schema exposes every field). At request time nil `locales` means "no locales" (the tool schema renders `locale` as `z.never()` with "No locale access for this action."). At boot, nil means "invalid, delete".

#### Suggested labels

`issue: bug`, `severity: high`, `source: core:admin`, `version: 5`

#### Related

- #27417, the original filing of this same report, auto-closed on template format before triage.
- PR #25657 (merged 2026-04-29) introduced token-owned admin permissions and edited this cleanup without extending `filterPermissionsToRemove`.
- PR #27027 (merged 2026-07-16) fixes "Select all" in the Admin token permission editor. Same feature area, front-end only, unrelated to persistence.
- PR #26371 (merged 2026-05-27) added the MCP server, which is the surface the loss is easiest to observe on, not the cause.
- Searches for an existing report (`admin token permissions`, `permissions deleted restart`, including PRs) found nothing.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.

### Confirmation Checklist

- [x] I have checked the existing [issues](https://github.com/strapi/strapi/issues) for duplicates.
- [x] I agree to follow this project's [Code of Conduct](https://github.com/strapi/strapi/blob/develop/CODE_OF_CONDUCT.md).
