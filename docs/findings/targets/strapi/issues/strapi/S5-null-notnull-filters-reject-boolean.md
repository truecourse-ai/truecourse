---
finding: S5
target: strapi/strapi
route: public issue
title: MCP $null and $notNull filters reject the boolean the rest of Strapi requires, and invert the value they do accept
labels: none (BUG_REPORT.yml applies no automatic labels)
status: draft
reverified: yes (develop c7dbadd4fe / 5.52.1, 2026-08-19)
---

# MCP $null and $notNull filters reject the boolean the rest of Strapi requires, and invert the value they do accept

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

The MCP `list_<type>` tool documents fifteen field operators, `$null` and `$notNull` among them. Nineteen of the twenty-one enumerated operators work. `$null` and `$notNull` are unusable on every scalar attribute type except boolean, because the tool schema gives each operator the field's own value type instead of a boolean: on a string field `{"authorName":{"$null":true}}` is rejected at the boundary with `MCP error -32602: Invalid input at filters.$and[1].authorName`, before any query is built. Everywhere else in Strapi these two operators take a boolean, and Strapi's own test suite writes `{ $null: true }` on string and datetime fields.

The second half is worse than the rejection. The advertised schema does accept `null` as the value, and `null` is force-cast to `false` downstream, so a client that reads the tool's own JSON schema and sends `{"$null": null}` gets `whereNotNull`, the exact complement of what it asked for, with no error.

### What the docs say

From https://docs.strapi.io/cms/features/strapi-mcp-server (Usage > Content management through prompts > Filtering):

> The `list` tool accepts a `filters` parameter using Strapi's filter syntax:
>
> - **Field operators**: `$eq`, `$ne`, `$in`, `$notIn`, `$lt`, `$lte`, `$gt`, `$gte`, `$between`, `$contains`, `$notContains`, `$startsWith`, `$endsWith`, `$null`, `$notNull`, and their case-insensitive variants (`$eqi`, `$nei`, `$containsi`, `$notContainsi`, `$startsWithi`, `$endsWithi`).

### Observed

Run on 2026-08-19 against `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, instance reporting Strapi 5.52.1. Three articles, two with an `authorName`, one without.

- `{"authorName":{"$null":true}}`: `200 OK`, `isError: true`, text `MCP error -32602: Input validation error: Invalid arguments for tool list_article: Invalid input at filters.$and[1].authorName`.
- `{"authorName":{"$notNull":true}}`: identical rejection.
- `{"authorName":{"$null":null}}`: `200 OK`, no error, `total = 2`, and the two documents returned are the ones that **do** have an author name.
- What `tools/list` advertises for those two operators on the string field `authorName`:

```json
{"anyOf": [{"type":"string"},
           {"type":"array","items":{"type":"string"}},
           {"type":"null"}]}
```

Boolean is not in the union. `null`, which force-casts to `false` downstream, is.

## Steps to Reproduce

Build tested: `strapi/strapi` `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19), run from source with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`, `server.mcp.enabled: true`. The instance reports 5.52.1 on node v24.14.1. The original run was on 5.52.0 @ `c43e9ee1e2`.

Setup: an Admin token with read and create on `api::article.article`. Three articles created through `create_article` with the shared tag `opmt0g6lmy`: `tcref-opmt0g6lmy-alpha` (`authorName` `TCRef-Writer`), `tcref-opmt0g6lmy-beta` (`authorName` `tcref-writer`), `tcref-opmt0g6lmy-gamma` (no `authorName`, so null).

1. Ask for the documents with no author name, the shape the rest of Strapi requires:

```
POST /mcp
Authorization: Bearer <admin token accessKey>
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":210,"method":"tools/call","params":{
  "name":"list_article",
  "arguments":{"filters":{"$and":[{"title":{"$contains":"opmt0g6lmy"}},
                                  {"authorName":{"$null":true}}]}}}}
```

`200 OK`, `isError: true`, `MCP error -32602: Input validation error: Invalid arguments for tool list_article: Invalid input at filters.$and[1].authorName`.

2. The same request with `{"authorName":{"$notNull":true}}` (id 211). Same rejection.

3. The value the advertised schema does accept:

```
{"jsonrpc":"2.0","id":212,"method":"tools/call","params":{
  "name":"list_article",
  "arguments":{"filters":{"$and":[{"title":{"$contains":"opmt0g6lmy"}},
                                  {"authorName":{"$null":null}}]}}}}
```

`200 OK`, no error, `total = 2`, titles `["tcref-opmt0g6lmy-alpha", "tcref-opmt0g6lmy-beta"]`. Those are the two articles that have an author name.

4. `tools/list` and read `list_article.inputSchema.properties.filters` to see the advertised union quoted above.

Re-verified on `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (Strapi 5.52.1) on 2026-08-19: still reproduces. The original 5.52.0 run recorded the same `-32602 ... Invalid input at filters.$and[1].authorName` for `$null: true`; steps 2 and 3 above were added in the re-run, so the `$notNull` half and the inverted result are now observed rather than inferred.

## Expected Behavior

`{"field":{"$null":true}}` returns the documents whose field is null, and `{"field":{"$notNull":true}}` returns the rest, on any attribute type, as they do through REST, through the Document Service and in Strapi's own test suite. The tool's advertised schema types these two operators as boolean. No value that passes the advertised schema is answered with the complement of the request.

## Additional information

### Cause

`buildFiltersSchema` derives one value schema per field from the field's attribute type (`attributeTypeToFilterValue`, line 9: a string, text, uid or date attribute yields `z.union([z.string(), z.array(z.string()), z.null()])`), then maps every entry of `FILTER_OPERATORS` onto that same value schema: https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/content-manager/server/src/mcp/schemas/filters-schema.ts#L84-L92 (`const valueSchema = attributeTypeToFilterValue(attr)` at line 86, `Object.fromEntries(FILTER_OPERATORS.map((op) => [op, valueSchema.optional()]))` at line 88).

`$null` and `$notNull` are not value comparisons, they are boolean flags, and the rest of Strapi types them that way: `packages/core/utils/src/convert-query-params.ts:738` runs `parseType({ type: 'boolean', value, forceCast: true })` on them, `packages/core/database/src/query/helpers/where.ts:315-330` branches on truthiness, and Strapi's own suite writes `{ $null: true }` on string and datetime fields (`tests/api/core/strapi/filtering.test.api.js:378`, `tests/api/core/strapi/document-service/publish.test.api.ts:59`). Because `authorName` is a string attribute, the operator object types `$null` as `string | string[] | null`, so `true` is a Zod type error and the MCP SDK rejects the call with `-32602`. The operators only work where `valueSchema` is `z.boolean()`, that is on boolean attributes. On integer and decimal fields the value schema is `number | number[]`, so they are rejected there too.

The `null` inversion comes from the same line: `null` is the only non-string member of the advertised union, and `parseType(..., forceCast: true)` turns it into `false`, which the where helper reads as `whereNotNull`.

Introduced by PR #26371 (`feat(*): introduce MCP server`, commit `d6f693da85`, merged 2026-05-27); git blame puts every line of `filters-schema.ts` on it. The file was born with this. The boolean contract it violates predates the MCP server by years. There is no unit test over `buildFiltersSchema` (`mcp/schemas/__tests__/` holds only `output-schemas.test.ts`), which is how a 21-operator schema shipped with two operators typed wrong.

Today's head still has it, byte-identical: https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/content-manager/server/src/mcp/schemas/filters-schema.ts#L84-L92

The minimal fix is to special-case `$null` and `$notNull` to `z.boolean()` in the `FILTER_OPERATORS` map instead of giving them the field's value schema. The same line is also why `$eq` and `$contains` accept arrays and `$in` and `$between` accept bare scalars.

One workaround, read from source and not exercised in this run: `{"$null": "true"}` and `{"$null": "false"}` pass the schema and are coerced correctly by `parseType` (`TRUTHY_INPUTS` / `FALSY_INPUTS` in `packages/core/utils/src/parse-type.ts`).

### Related

- PR #26990 (open, `feat(content-manager): add populate/fields/filters + depth guard to MCP read tools`, last pushed 2026-08-18) is the only upstream item that edits this file. It refactors the per-field builder into a new `buildScalarFieldFilter` helper and extends filters to nested component fields, and it carries the faulty pair of lines forward verbatim (`const valueSchema = attributeTypeToFilterValue(attr)` followed by the same `FILTER_OPERATORS.map`). Merging it as it stands keeps `$null` and `$notNull` broken and extends the same bug to nested component fields, so its author is the right person to fix this in place.
- PR #26371 (merged 2026-05-27) introduced the schema.
- Issue #27395 (open) is a different MCP tool-schema defect (the advertised JSON Schema dialect), not a duplicate.
- Searches for `MCP filters $null`, `MCP filters` and `notNull filter operator`, including PRs, found no existing report.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
