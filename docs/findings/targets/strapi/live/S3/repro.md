# S3 live re-verification: `set: null` (clear all relations) is a no-op that returns success

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`.
- **Verdict: still reproduces.**

## Seed for this scenario

Same instance and same admin token as S2 (`tcref-mcp-rel-mt0g5p53`, five content-manager permissions on article and category). Same article `b69aib6pqn0itpkibeuxot0p` and category `xculmsrqzvdw9yfxlbhe47qb` (`tcref-cat-one-mt0g5p53`).

State immediately before the step under test: `categories` holds exactly `xculmsrqzvdw9yfxlbhe47qb`, confirmed by the `get_article` read-back recorded in `../S2/step-2.get_article.readback.json`.

## Steps

### 1. `categories: { set: null }`, the documented way to clear all relations

```
POST http://127.0.0.1:1347/mcp
Authorization: Bearer <admin token accessKey, redacted>
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":106,"method":"tools/call","params":{
  "name":"update_article",
  "arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p",
    "data":{"title":"tcref-rel-mt0g5p53","categories":{"set":null}}}}}
```

Response `200 OK`, SSE tool result, **no `isError`**. The write ran: `updatedAt` advanced from `2026-08-19T18:50:37.962Z` to `2026-08-19T18:50:38.033Z`. The reply's own `categories` field reads `[]`, which is the S4 misreport and which agrees with the caller's wrong belief that the field is now empty.

Raw capture: `step-1.update_article.set-null.json`.

### 2. Read the document back

```
POST /mcp {"jsonrpc":"2.0","id":107,"method":"tools/call",
           "params":{"name":"get_article","arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p"}}}
```

`200 OK`:

```json
"categories": [{"documentId":"xculmsrqzvdw9yfxlbhe47qb","locale":"en"}]
```

The relation survived. `set: null` changed nothing and reported success.

Raw capture: `step-2.get_article.readback.json`.

## Comparison with the original transcript

This defect was **not** observable in the transcript named for the S2 review, because that run aborted on the mutual-exclusivity step. It was executed in the sibling run `2026-08-14T15-15-28Z_32215874` of the same scenario, whose step 21 sent `{"set": null}` and got HTTP 200 with no `isError` and `updatedAt` advancing from `...15:15:31.635Z` to `...15:15:31.682Z`, and whose step 22 read back `categories: [{documentId: dima4a0q16kvqd5l56t6hnza, locale: en}]`.

This re-verification matches that sibling run on every observable: 200, no `isError`, `updatedAt` advanced by about 70 ms, relation intact after the call.

## Source state on the re-verified build

`packages/core/database/src/entity-manager/index.ts` still tests `if (data?.set)` by truthiness in `toAssocs`, so `{ set: null }` falls through to the partial-update branch and the `set` key is discarded. Unchanged from the tested build.

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`. A destructive intent, expressed the documented way, is a silent no-op that answers success.
