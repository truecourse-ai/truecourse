---
finding: S4
target: strapi/strapi
route: public issue
title: MCP create and update replies report every to-many relation as an empty array
labels: none (BUG_REPORT.yml applies no automatic labels)
status: draft
reverified: yes (develop c7dbadd4fe / 5.52.1, 2026-08-19)
---

# MCP create and update replies report every to-many relation as an empty array

## Environment (BUG_REPORT.yml required fields)

| Field | Value |
|---|---|
| Node Version | 24.14.1 |
| Package Manager | yarn |
| Package Manager Version | 4.12.0 |
| Strapi Version | 5.52.1 |
| Operating System | MacOS |
| Database | SQLite |
| Javascript or Typescript | JavaScript |

## Bug Description

Every write reply from the MCP collection-type tools reports to-many relations as an empty array, whatever the document actually holds. The write itself is correct: `get_<type>` on the same document, at the same `updatedAt`, returns the relation. Only the reply is false. The reply is schema-valid (the registered output schema types the field as an array of identity objects), so nothing flags it.

This is the reply an MCP client sees immediately after its own write, so it is the reply an agent is most likely to act on: it can conclude the relation write produced an empty field and "repair" it by connecting again, or report the loss to the user. The scope is `create`, `update`, `publish`, `unpublish` and `discard_draft` on collection types. Single types are not affected, because their write handler passes an explicit populate.

Two further defects in the same relation path are filed separately: "MCP relation write accepts set and connect in one payload and silently discards connect" and "Relation write with set: null returns success and clears nothing". This issue compounds the second one, since the false `categories: []` reply agrees with the caller's wrong belief that the field was cleared.

### What the docs say

From https://docs.strapi.io/cms/features/strapi-mcp-server (Usage > Content management through prompts > Relations, the to-many relation keys table):

> | `connect` | Add relations. Accepts an array of document ID strings or `{ documentId, locale?, status?, position? }` objects. ... |
> | `disconnect` | Remove relations. Accepts an array of document ID strings or `{ documentId, locale?, status? }` objects. |
> | `set` | Replace all existing relations with the provided array. Pass `null` to clear all relations. Mutually exclusive with `connect`/`disconnect`. |

The documented meaning of a successful `connect` is that the relation is on the document. The reply says the opposite.

### Observed

Run on 2026-08-19 against `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, instance reporting Strapi 5.52.1. Three consecutive writes, all replying `"categories":[]`, each followed or accompanied by a `get_article` read-back that returns one category:

| call | reply `categories` | `get_article` read-back |
|---|---|---|
| `update_article` with `{connect:[cat1]}` | `[]` | `[{"documentId":"xculmsrqzvdw9yfxlbhe47qb","locale":"en"}]` |
| `update_article` with `{set:[cat1], connect:[cat2]}` | `[]` | `[{"documentId":"xculmsrqzvdw9yfxlbhe47qb","locale":"en"}]` |
| `update_article` with `{set:null}` | `[]` | `[{"documentId":"xculmsrqzvdw9yfxlbhe47qb","locale":"en"}]` |

For the first row the read-back carries the same `updatedAt` as the write reply (`2026-08-19T18:50:37.881Z`), so nothing changed between the two reads. Every write reply observed in the session was false.

## Steps to Reproduce

Build tested: `strapi/strapi` `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19), run from source with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`, `server.mcp.enabled: true`. The instance reports 5.52.1 on node v24.14.1. The original run was on 5.52.0 @ `c43e9ee1e2`.

Setup: an Admin token with read, create and update on `api::article.article` and read and create on `api::category.category`. One category `xculmsrqzvdw9yfxlbhe47qb` and one article `b69aib6pqn0itpkibeuxot0p` with no categories yet.

1. Connect one category:

```
POST /mcp
Authorization: Bearer <admin token accessKey>
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":102,"method":"tools/call","params":{
  "name":"update_article",
  "arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p",
    "data":{"title":"tcref-rel-mt0g5p53",
            "categories":{"connect":["xculmsrqzvdw9yfxlbhe47qb"]}}}}}
```

`200 OK`, no `isError`, `updatedAt` `2026-08-19T18:50:37.881Z`, and the reply carries `"categories": []`.

2. Read the same document back:

```
POST /mcp
{"jsonrpc":"2.0","id":103,"method":"tools/call",
 "params":{"name":"get_article","arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p"}}}
```

`200 OK`, same `updatedAt`, and:

```json
"categories": [{"documentId":"xculmsrqzvdw9yfxlbhe47qb","locale":"en"}]
```

The write landed. Its own reply reported the opposite.

Repeating with `set` or `disconnect`, or with `create_article` on a document that has relations, gives the same `[]`.

Re-verified on `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (Strapi 5.52.1) on 2026-08-19: still reproduces, over three writes. The original 5.52.0 run recorded the same `[]` at every `update_article` reply (seven of them), with `get_article` returning the truthful identity array each time.

## Expected Behavior

A write reply reports the document's actual relations, the same identity-only array `get_<type>` returns for the same document at the same `updatedAt`. If the write path cannot cheaply produce that, the field is omitted rather than reported as empty.

## Additional information

### Cause

The MCP collection update handler calls `documentManager.update(documentId, uid, { data, locale })` with no `populate` option (`packages/core/content-manager/server/src/mcp/handlers/collection-handlers.ts:317-325`; the populate it builds at lines 280-282 is used only for the pre-read `findOne`). `documentManager.update` then falls back to `buildDeepPopulate(uid)` (`services/document-manager.ts:100`, `services/utils/populate.ts:441-455`), which is `populateDeep(Infinity).countRelations()`, so every to-many relation comes back as `{ count: N }`, the shape the admin panel wants. `reduceToIdentity` then maps any non-array value, `{ count: N }` included, to `[]` under a comment calling it defensive: https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/content-manager/server/src/mcp/sanitizers/shape-relations.ts#L73-L98 (the to-many branch is lines 79-85). Net effect: one related document is rendered as zero.

Introduced by PR #26560 (`fix(content-manager): reduce MCP relation output to identity-only shape`, commit `00da31ed44`, merged 2026-06-19). Before it the update reply carried `categories: {count: 1}`, odd but truthful. That PR added the non-array to `[]` coercion and removed `.countRelations()` only from the list and get handlers, which build their own populate; the create, update, publish, unpublish and discard_draft handlers were left on the count-shaped default. Its api tests (`tests/api/core/mcp/mcp-content-manager-shaping.test.api.ts`) cover only the get and list tools, which is why the write replies were missed. Single types are unaffected: `mcp/handlers/single-type-handlers.ts:116-118` passes an explicit populate.

Today's head still has it, byte-identical: https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/content-manager/server/src/mcp/sanitizers/shape-relations.ts#L73-L98

Either fix works: pass a non-count populate from the MCP write handlers, or make `reduceToIdentity` refuse to translate `{ count: N }` into `[]`.

### Related

- PR #26560 (merged 2026-06-19) introduced the misreport.
- PR #26990 (open, `feat(content-manager): add populate/fields/filters + depth guard to MCP read tools`, last pushed 2026-08-18) is actively rewriting `shape-relations.ts`, adding an inline-relation resolver and a `shouldInline` predicate, but it does not fix this: its first hunk on that file starts at line 98, so `reduceToIdentity` and its `{ count: N }` coercion at lines 83-84 are untouched context, and its `collection-handlers.ts` hunks stop well before the update handler at 317-325. If it merges as it stands, this defect survives it, so folding a fix into that PR is probably the cheapest path.
- Issue #27395 (open) is a different MCP tool-schema defect, not a duplicate.
- Searches for `mcp relation` and related phrasings found no existing report of the empty reply.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
