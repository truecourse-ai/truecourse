---
finding: S3
target: strapi/strapi
route: public issue
title: Relation write with set: null returns success and clears nothing
labels: none (BUG_REPORT.yml applies no automatic labels)
status: filed
filed_url: https://github.com/strapi/strapi/issues/27432
filed_at: 2026-08-20
format_note: Body follows strapi/strapi BUG_REPORT.yml exactly (### headers per field + both checkboxes).
reverified: yes (develop c7dbadd4fe / 5.52.1, 2026-08-19)
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

`set: null` on a to-many relation is documented as the way to clear all relations. It is a no-op that answers success: HTTP 200, no error, `updatedAt` advanced, and the relation still there afterwards. The blame is in the database package, not in MCP: `toAssocs` tests `data.set` by truthiness, so the `set` key is dropped from the payload and the write degrades into an empty partial update. Any Document Service caller passing `{ set: null }` has the same result, and has had since v4. The MCP tool schema, which accepts `null` for `set` and describes it as "null clears all", is what makes it a user-visible promise.

The asymmetry is worth stating plainly: `categories: null` does clear the relation, `categories: { set: null }` does not.

Two further defects in the same relation path are filed separately: "MCP relation write accepts set and connect in one payload and silently discards connect" (one line away in the same function) and "MCP create and update replies report every to-many relation as an empty array". The third one compounds this one: the reply to the no-op write reports `categories: []`, so the success confirmation actively agrees with the caller's wrong belief that the field is now empty.

#### What the docs say

From https://docs.strapi.io/cms/features/strapi-mcp-server (Usage > Content management through prompts > Relations, the to-many relation keys table):

> | `set` | Replace all existing relations with the provided array. Pass `null` to clear all relations. Mutually exclusive with `connect`/`disconnect`. |

#### Observed

Run on 2026-08-19 against `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, instance reporting Strapi 5.52.1. Before the call, `categories` held exactly `xculmsrqzvdw9yfxlbhe47qb`.

The `set: null` call answered `200 OK`, tool result, no `isError`, and `updatedAt` advanced from `2026-08-19T18:50:37.962Z` to `2026-08-19T18:50:38.033Z`, so a write ran. The reply's own `categories` field reads `[]`. The read-back immediately after returns:

```json
"categories": [{"documentId":"xculmsrqzvdw9yfxlbhe47qb","locale":"en"}]
```

The relation survived. Nothing was logged.

### Steps to Reproduce

Build tested: `strapi/strapi` `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19), run from source with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`, `server.mcp.enabled: true`. The instance reports 5.52.1 on node v24.14.1. The original run was on 5.52.0 @ `c43e9ee1e2`.

Setup: an Admin token with read, create and update on `api::article.article` and read and create on `api::category.category`. One article (`b69aib6pqn0itpkibeuxot0p`) whose `categories` holds exactly one category (`xculmsrqzvdw9yfxlbhe47qb`).

1. Clear the relation the documented way:

```
POST /mcp
Authorization: Bearer <admin token accessKey>
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":106,"method":"tools/call","params":{
  "name":"update_article",
  "arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p",
    "data":{"title":"tcref-rel-mt0g5p53","categories":{"set":null}}}}}
```

`200 OK`, no `isError`, `updatedAt` advanced by about 70 ms.

2. Read the document back:

```
POST /mcp
{"jsonrpc":"2.0","id":107,"method":"tools/call",
 "params":{"name":"get_article","arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p"}}}
```

`200 OK`, `categories` still holds `xculmsrqzvdw9yfxlbhe47qb`.

The same thing happens without MCP, through the Document Service API: `strapi.documents('api::article.article').update({ documentId, data: { categories: { set: null } } })` returns the document with the relation intact.

Re-verified on `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (Strapi 5.52.1) on 2026-08-19: still reproduces, matching the original 5.52.0 run on every observable (200, no `isError`, `updatedAt` advancing from `15:15:31.635Z` to `15:15:31.682Z`, relation intact at the read-back).

### Expected Behavior

`{ set: null }` clears every relation on the field, as the documentation and the tool schema both state. If it is not going to clear them, the call is rejected rather than answered with a success and a bumped `updatedAt`.

### Additional information

#### Cause

`toAssocs` tests `if (data?.set)` by truthiness at line 162: https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/database/src/entity-manager/index.ts#L149-L180

`{ set: null }` fails that test, falls through to the partial-update branch and becomes `{ options, connect: [], disconnect: [] }`, losing the `set` key. The consumer then cannot see the intent: `updateRelations` branches on `isNull(cleanRelationData.set)` at line 1195 for the clear-everything path, and computes `isPartialUpdate = !has('set', cleanRelationData)` at line 1198. Because the key is already gone, the write is treated as a partial update with an empty connect and an empty disconnect, so nothing is added and nothing is deleted. The null intent does survive on the other route through the same function: line 158 turns a relation value that is itself `null` into `{ set: null }`, which is why `categories: null` clears and `categories: { set: null }` does not.

The MCP layer passes the payload through untouched (`map-relation.ts:75` hands `{ set: null }` to the default visitor, which returns it unchanged), and the MCP schema correctly accepts `null` for `set`.

Introduced by `c1d82b6f9e` (2022-09-19, PR #14327, "use set format"), so this is v4-era behaviour on every Document Service caller. PR #26371 (`feat(*): introduce MCP server`, 2026-05-27) is what turned it into a broken published promise, by adding a tool schema whose `set` key accepts `z.null()` and describes it as "null clears all".

Today's head still has it, byte-identical: https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/database/src/entity-manager/index.ts#L149-L180

The one-line fix is `if ('set' in data)` (or `if (data?.set !== undefined)`) instead of `if (data?.set)`. It needs regression tests rather than a straight swap: the truthiness check has been load-bearing since v4, and `set: []`, which is already truthy, is the current working way to clear a relation.

#### Suggested labels

`issue: bug`, `severity: high`, `source: core:database`, `version: 5`

#### Related

- PR #14327 (merged 2022-09-30) introduced the truthiness check.
- PR #26371 (merged 2026-05-27) added the MCP schema and doc text that promise the behaviour.
- PR #27115 (open) edits the MCP relation data schema but not this path, and the fix belongs in the database package anyway.
- Issue #27395 (open) is a different MCP tool-schema defect, not a duplicate.
- Searches for `clear all relations set null` and `relation disconnect connect not working update` found no existing report.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.

### Confirmation Checklist

- [x] I have checked the existing [issues](https://github.com/strapi/strapi/issues) for duplicates.
- [x] I agree to follow this project's [Code of Conduct](https://github.com/strapi/strapi/blob/develop/CODE_OF_CONDUCT.md).
