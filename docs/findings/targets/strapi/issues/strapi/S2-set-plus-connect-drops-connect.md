---
finding: S2
target: strapi/strapi
route: public issue
title: MCP relation write accepts set and connect in one payload and silently discards connect
labels: none (BUG_REPORT.yml applies no automatic labels)
status: filed
filed_url: https://github.com/strapi/strapi/issues/27421
filed_at: 2026-08-19
format_note: Body follows strapi/strapi BUG_REPORT.yml exactly (### headers per field + both required checkboxes). A table or custom headings gets auto-flagged and closed by linear-code[bot].
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

The MCP server documentation, and the tool schema's own field description, say `set` is mutually exclusive with `connect` and `disconnect`. An `update_<type>` call that sends both is accepted anyway: HTTP 200, no `isError`, `updatedAt` advanced. The `connect` half is discarded before the write reaches the database, so one of the two requested relation writes is lost with no error, no warning and no trace in the reply. The caller most likely to emit the forbidden combination is an LLM, and the reply it gets back is a plain success.

Two further defects in the same relation path are filed separately, because they have different causes and different fixes: "Relation write with set: null returns success and clears nothing" and "MCP create and update replies report every to-many relation as an empty array". The second one compounds this issue, because the reply to the write below also reports `categories: []`.

#### What the docs say

From https://docs.strapi.io/cms/features/strapi-mcp-server (Usage > Content management through prompts > Relations, the to-many relation keys table):

> | `set` | Replace all existing relations with the provided array. Pass `null` to clear all relations. Mutually exclusive with `connect`/`disconnect`. |

The same sentence is inside the product: the `set` key's `.describe()` string in the MCP tool schema reads "Replace all relations. Array replaces existing; null clears all. Mutually exclusive with connect/disconnect."

#### Observed

Run on 2026-08-19 against `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, instance reporting Strapi 5.52.1. Before the call, `categories` held exactly `cat1` (`xculmsrqzvdw9yfxlbhe47qb`).

The call carrying both keys answered `200 OK` with an SSE-framed tool result, no `isError`, and `updatedAt` advanced from `2026-08-19T18:50:37.881Z` to `2026-08-19T18:50:37.962Z`, so the write was executed rather than refused. The `get_article` read-back at the next step returns:

```json
"categories": [{"documentId":"xculmsrqzvdw9yfxlbhe47qb","locale":"en"}]
```

`cat1` (the `set` value) is present. `cat2` (the `connect` value, `vl6ebvopem294co43mmqvvx2`) is absent. Nothing was logged: the server log shows only `POST /mcp ... 200`.

### Steps to Reproduce

Build tested: `strapi/strapi` `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19), run from source with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`, `server.mcp.enabled: true`. The instance reports 5.52.1 on node v24.14.1. The original run was on 5.52.0 @ `c43e9ee1e2`.

Setup: an Admin token with read, create and update on `api::article.article` and read and create on `api::category.category`. Through MCP, two categories (`xculmsrqzvdw9yfxlbhe47qb`, `vl6ebvopem294co43mmqvvx2`) and one article (`b69aib6pqn0itpkibeuxot0p`) whose `categories` holds only the first category.

1. Send one relation object carrying both `set` and `connect`:

```
POST /mcp
Authorization: Bearer <admin token accessKey>
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":104,"method":"tools/call","params":{
  "name":"update_article",
  "arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p",
    "data":{"title":"tcref-rel-mt0g5p53",
      "categories":{"set":["xculmsrqzvdw9yfxlbhe47qb"],
                    "connect":["vl6ebvopem294co43mmqvvx2"]}}}}}
```

`200 OK`, tool result, no `isError`, `updatedAt` advanced.

2. Read the document back:

```
POST /mcp
{"jsonrpc":"2.0","id":105,"method":"tools/call",
 "params":{"name":"get_article","arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p"}}}
```

`200 OK`, `categories` holds only `xculmsrqzvdw9yfxlbhe47qb`. The connected category was never written.

Re-verified on `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (Strapi 5.52.1) on 2026-08-19: still reproduces. The original run on 5.52.0 recorded the identical acceptance (200, no `isError`, `updatedAt` advancing from `15:19:01.523Z` to `15:19:01.573Z`); the read-back above was added in the re-run and confirms the discard directly.

### Expected Behavior

A payload that combines `set` with `connect` or `disconnect` is rejected at the tool boundary, since the schema is the only place the documented mutual exclusion can be enforced. Failing that, both operations are applied. What must not happen is the current outcome: the combination is accepted, reported as a success, and one operation is dropped without a diagnostic.

The exact error text is not the point of this report. The docs state the constraint but do not promise a specific message, so any clear input validation error is fine.

### Additional information

#### Cause

The to-many relation input schema is `z.object({ connect, disconnect, set }).strict()` with all three keys independently `.optional()` and no `.refine()` or `.superRefine()` tying them together, so `{ set, connect }` validates: https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/content-manager/server/src/mcp/schemas/data-schema.ts#L235-L256 . The `set` key's own `.describe()` at line 253 states the rule the schema does not check.

Nothing downstream enforces it either. The document service relation transform keeps all three keys (`packages/core/core/src/services/document-service/transform/relations/utils/map-relation.ts:75-98`), and the database layer resolves the conflict by preferring `set`: `toAssocs` in `packages/core/database/src/entity-manager/index.ts` (line 149, short circuit at line 162) returns `{ set: [...] }` and drops `connect` and `disconnect` entirely as soon as `data.set` is truthy. That short circuit is from `c1d82b6f9e` (2022-09-19, PR #14327), so the drop is v4-era engine behaviour. The generated REST routes never expose these keys (`packages/core/core/src/core-api/routes/validation/attributes.ts:639-649` maps a relation input to a bare array of documentIds), which is why the MCP tool schema is the only boundary where the rule can bite.

The schema itself was written by PR #26371 (`feat(*): introduce MCP server`, commit `d6f693da85`, merged 2026-05-27), which is the first surface that lets a caller send `set` and `connect` in one payload and documents them as mutually exclusive.

Today's head still has both halves, byte-identical: https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/content-manager/server/src/mcp/schemas/data-schema.ts#L235-L256

#### Suggested labels

`issue: bug`, `severity: high`, `source: core:content-manager`, `version: 5`

#### Related

- PR #27115 (open, `fix(content-manager): align MCP draft write schemas with admin draft leniency`) edits the same file but only the scalar and component required-field projection. Its diff has no hunk on the to-many relation object, so it does not add the missing refinement.
- PR #26560 (merged 2026-06-19) reshaped MCP relation output. It does not touch input validation.
- PR #26371 (merged 2026-05-27) introduced the schema.
- Issue #27395 (open) is a different MCP tool-schema defect (the advertised JSON Schema dialect), not a duplicate.
- Searches for `mcp relation`, `relations connect set silently`, `relation disconnect connect not working update` found no existing report of this.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.

### Confirmation Checklist

- [x] I have checked the existing [issues](https://github.com/strapi/strapi/issues) for duplicates.
- [x] I agree to follow this project's [Code of Conduct](https://github.com/strapi/strapi/blob/develop/CODE_OF_CONDUCT.md).
