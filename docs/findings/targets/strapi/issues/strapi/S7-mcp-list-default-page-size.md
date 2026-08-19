---
finding: S7
target: strapi/strapi
route: public issue
title: MCP list_* tools return 10 items per page while their own tools/list schema and the docs say 25
labels: none (BUG_REPORT.yml applies no automatic labels)
status: draft
reverified: yes (develop c7dbadd4fe / 5.52.1, 2026-08-19)
---

# MCP list_* tools return 10 items per page while their own tools/list schema and the docs say 25

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

The MCP server advertises, in the JSON Schema it serves from `tools/list`, that `pageSize` on every `list_*` tool has a default of 25, and the MCP documentation page repeats that number. A `list_*` call that passes no pagination arguments comes back with `pagination.pageSize: 10`. The same Strapi instance answers `pageSize: 25` over REST for the same collection, so the product disagrees with itself inside one process. An MCP client that trusts the advertised schema reads 10 of the first 25 entries, and any page arithmetic it does off 25 skips rows: a model can conclude a collection is smaller than it is, with no error anywhere to signal it.

### What the docs say

https://docs.strapi.io/cms/features/strapi-mcp-server, section "Usage > Content management through prompts > Pagination":

> The `list` tool also accepts `page` (1-indexed, default: 1) and `pageSize` (default: 25, max: 100) parameters.

The same number is shipped inside the product, in the Zod description that becomes the tool's JSON Schema, so this is not only a docs mismatch: `packages/core/content-manager/server/src/mcp/schemas/input-schemas.ts:33` reads `Items per page (default: 25, max: 100).`

### Observed

`tools/call` on `list_article` with only a `filters` argument, HTTP 200, tool result pagination block:

```json
{"page":1,"pageSize":10,"pageCount":1,"total":3}
```

The value 10 appears in both the text content and the `structuredContent` of the tool result, so it is the tool's reported contract, not a transport artifact.

`tools/list` on the same server, same session, for the same tool:

```json
"pageSize": {"description":"Items per page (default: 25, max: 100).",
             "type":"integer","minimum":1,"maximum":100}
```

REST on the same instance, same content type, `GET /api/articles?status=draft`:

```json
"meta": {"pagination":{"page":1,"pageSize":25,"pageCount":1,"total":9}}
```

`GET /api/articles` without the parameter answers `pageSize: 25` as well. The 25 is `api.rest.defaultLimit`, which is the framework default and is what the example app also sets.

### Cause

`packages/core/content-manager/server/src/mcp/handlers/collection-handlers.ts:88-93` (https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/content-manager/server/src/mcp/handlers/collection-handlers.ts#L88-L93) builds the query with `...(page !== undefined && { page })` and `...(pageSize !== undefined && { pageSize })`, so when the caller omits both, no pagination key reaches the query at all. The handler then calls `documentManager.findPage`, which is `pagination.withDefaultPagination(opts, { maxLimit: 1000 })` with no `defaultLimit` (`packages/core/content-manager/server/src/services/document-manager.ts:70-73`). With neither key present, `withDefaultPagination` takes its "no pagination attribute" branch and merges the offset defaults `{ start: 0, limit: 10 }` from `STRAPI_DEFAULTS`, and `transformPagedPaginationInfo` then derives `pageSize = limit = 10`. That 10 is hardcoded in `packages/core/utils/src/pagination.ts:28-37` and is not read from config, so no application setting can move it: the effective MCP default is always 10. REST gets 25 because the core API service supplies `api.rest.defaultLimit` (default 25, `packages/core/core/src/core-api/service/pagination.ts:35`), a config the content-manager path never consults. Both halves were written by PR #26371 "feat(\*): introduce MCP server" (commit d6f693da85, 2026-05-27): the "default: 25" description and the omit-when-undefined query build. The 10 it falls back to is four-year-old content-manager code, so the new half is the wrong half. Today's head still has both: https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/content-manager/server/src/mcp/handlers/collection-handlers.ts#L88-L93

Two facts that may save triage time. The MCP unit tests are green on 25 only because they mock `documentManager.findPage` and hardcode `pagination: { page: 1, pageSize: 25 }` in the mock's return value (`packages/core/content-manager/server/src/mcp/__tests__/derive-content-type-mcp-tools.test.ts:128-133` and `625-633`), so the assertion tests the mock, not the product. And the ceilings disagree as well as the defaults: the schema's `max: 100` is enforced by Zod at the tool boundary while `findPage` passes `maxLimit: 1000`, so the tighter one wins by accident.

The cheapest fix that keeps the shipped schema honest is one line in the handler: pass `page: page ?? 1, pageSize: pageSize ?? 25` instead of omitting the keys, which also makes the reported `page`/`pageSize` come from the page branch of `withDefaultPagination` rather than being back-derived from `start`/`limit`. Changing `STRAPI_DEFAULTS` is not an option, it is the admin content-manager default used across the panel. If 10 is the intended value, then `input-schemas.ts:33` has to change too, because the wrong number is inside the product and the docs are downstream of it.

### Related

- #26371 (merged 2026-05-27) introduced both the schema description and the handler that never passes a default.
- #26990 (open) edits the exact block in `collection-handlers.ts`, adding `fields`/`populate` to the same spread. Its current diff leaves `pageSize !== undefined` as unchanged context, so merging it does not fix this.
- strapi/documentation#3194 (merged 2026-05-28) added the "default: 25, max: 100" sentence, copied from the schema description.
- #27395 (open) is a different MCP schema defect (the advertised JSON Schema dialect), not this one.

## Steps to Reproduce

Build tested: `strapi/strapi` `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19), run from source with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start` (production start, not `develop`), sqlite at `examples/getstarted/.tmp/data.db`. The instance reports 5.52.1 on node v24.14.1. The original run was on 5.52.0 @ `c43e9ee1e2`.

1. Enable the MCP server in `config/server.js` with `mcp: { enabled: true }` and restart Strapi.
2. Create an admin token with read access to a collection type (`Article` below) and note its `accessKey`.
3. Create at least 3 entries of that collection type so a page can be counted.
4. Ask the server what it advertises:

```
POST /mcp
Authorization: Bearer <token>
Accept: application/json, text/event-stream
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

The `list_article` input schema contains `"pageSize": {"description":"Items per page (default: 25, max: 100).", "type":"integer","minimum":1,"maximum":100}`.

5. Call the tool with no pagination arguments:

```
POST /mcp
Authorization: Bearer <token>
Accept: application/json, text/event-stream
Content-Type: application/json

{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
  "name":"list_article","arguments":{"filters":{"title":{"$contains":"whatever"}}}}}
```

The response is HTTP 200 and the tool result's pagination block is `{"page":1,"pageSize":10,"pageCount":1,"total":3}`.

6. For comparison, on the same instance: `GET /api/articles` with a content API token answers `meta.pagination.pageSize: 25`.

Re-verified on develop c7dbadd4fe (5.52.1) on 2026-08-19: still reproduces, with `pageSize: 10` from MCP and `pageSize: 25` from REST on the same running instance. Originally observed on 5.52.0 at c43e9ee1e2.

## Expected Behavior

A `list_*` call with no pagination arguments returns the page size its own `tools/list` schema advertises, 25, matching both the REST default and the documented value. Alternatively, if 10 is the intended default for the content-manager path, the shipped schema description in `input-schemas.ts` and the documentation page state 10. Either way the advertised schema and the observed behavior agree, because MCP clients are machine consumers that plan their reads from that schema.

## Logs / Code Snippets

Not applicable: no error or log line is produced. The mismatch is silent and visible only by comparing the advertised schema with the response.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
