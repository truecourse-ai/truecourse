# S7 live re-verification: `list_*` default page size is 10; the tool's own schema and the docs say 25

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`.
- **Verdict: still reproduces.**

## Seed for this scenario

Same instance and admin token as S2. The three `opmt0g6lmy` articles from S5 are the subject.

## Steps

### 1. `list_article` with no pagination arguments at all

```
POST http://127.0.0.1:1347/mcp
Authorization: Bearer <admin token accessKey, redacted>
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":220,"method":"tools/call","params":{
  "name":"list_article","arguments":{"filters":{"title":{"$contains":"opmt0g6lmy"}}}}}
```

`200 OK`, and the tool result's pagination block is:

```json
{"page":1,"pageSize":10,"pageCount":1,"total":3}
```

Raw capture: `step-1.list_article.no-pagination.json`.

### 2. What the tool advertises for `pageSize` in its own `tools/list` schema

```json
"pageSize": {"description":"Items per page (default: 25, max: 100).",
             "type":"integer","minimum":1,"maximum":100}
```

Raw capture: `step-2.tools-list.pageSize-description.json`. The shipped schema says 25 and the shipped handler does 10.

### 3. REST, for comparison

```
GET /api/articles
Authorization: Bearer <full-access content API token, redacted>
```

`200 OK`, `meta.pagination` = `{"page":1,"pageSize":25,"pageCount":0,"total":0}` (total 0 because the instance's articles were drafts at that moment and REST defaults to published). Raw capture: `step-3.rest.get-api-articles.json`.

```
GET /api/articles?status=draft
```

`200 OK`, `meta.pagination` = `{"page":1,"pageSize":25,"pageCount":1,"total":9}`. Raw capture: `step-4.rest.get-api-articles-status-draft.json`.

REST answers 25 either way, which is `examples/getstarted`'s `config/api.js` `rest.defaultLimit: 25`, the number the docs quote. The MCP path never supplies it.

## Comparison with the original transcript

The original (evidence `2026-08-14T15-07-53Z_74b6e3f2`, failing step 7 of `the-list-tool-paginates-its-results.api.1`) recorded `{"page":1,"pageSize":10,"pageCount":1,"total":3}`, identical to this run down to the totals, since both scenarios create three documents. The same `pageSize: 10` also appeared in every list response of the filter-operators scenario, and it does here too.

## Source state on the re-verified build

`packages/core/content-manager/server/src/services/document-manager.ts` still calls `pagination.withDefaultPagination(opts, { maxLimit: 1000 })` with no `defaultLimit`, so `packages/core/utils/src/pagination.ts`'s hard-coded `pageSize: 10` wins, while `.../mcp/schemas/input-schemas.ts` still carries the "default: 25, max: 100" description. Unchanged from the tested build.

## Note on the environment

`examples/getstarted/config/api.js` pins `maxLimit: 30`, which is the S17 environment artifact. It was left as shipped and does not affect this finding, which is about the default rather than the ceiling.

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`. The product disagrees with itself inside one process: the schema it serves says 25, the handler behind it does 10, and REST on the same instance does 25.
