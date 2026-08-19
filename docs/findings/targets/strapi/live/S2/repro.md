# S2 live re-verification: `set` + `connect` in one relation write is accepted and `connect` is silently dropped

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`.
- **Verdict: still reproduces.**

## Seed for this scenario

Super admin `tc-reverify@example.com`. An admin token `tcref-mcp-rel-mt0g5p53` was minted through `POST /admin/admin-tokens` and re-granted through `PUT /admin/admin-tokens/:id` with exactly the five permissions the scenario yaml asks for (read, create and update on `api::article.article`, read and create on `api::category.category`, each with `properties.locales: ["en"]`). Both calls answered 201 / 200 with all five permissions attached.

Through MCP: two categories `tcref-cat-one-mt0g5p53` (`xculmsrqzvdw9yfxlbhe47qb`) and `tcref-cat-two-mt0g5p53` (`vl6ebvopem294co43mmqvvx2`), and one article `tcref-rel-mt0g5p53` (`b69aib6pqn0itpkibeuxot0p`). The documentIds were read back through `GET /content-manager/collection-types/...` with the admin jwt, as the yaml does, because an SSE framed tool reply cannot be captured from.

Before the step under test, `categories` held exactly `cat1` (established by a `connect` in the preceding step and confirmed by `get_article`).

## Steps

### 1. One relation object carrying both `set` and `connect`

```
POST http://127.0.0.1:1347/mcp
Authorization: Bearer <admin token accessKey, redacted>
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":104,"method":"tools/call","params":{
  "name":"update_article",
  "arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p",
    "data":{"title":"tcref-rel-mt0g5p53",
      "categories":{"set":["xculmsrqzvdw9yfxlbhe47qb"],
                    "connect":["vl6ebvopem294co43mmqvvx2"]}}}}}
```

Response `200 OK`, SSE framed tool result, **no `isError`**, and the write was executed: `updatedAt` advanced from `2026-08-19T18:50:37.881Z` to `2026-08-19T18:50:37.962Z`.

The tool's own `set` field description in the same schema reads "Replace all relations. Array replaces existing; null clears all. **Mutually exclusive with connect/disconnect.**" The combination it calls mutually exclusive is accepted without complaint.

Raw capture: `step-1.update_article.set-plus-connect.json`.

### 2. Read the truth back

```
POST /mcp {"jsonrpc":"2.0","id":105,"method":"tools/call",
           "params":{"name":"get_article","arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p"}}}
```

`200 OK`, and the relation holds:

```json
"categories": [{"documentId":"xculmsrqzvdw9yfxlbhe47qb","locale":"en"}]
```

`cat1` (the `set` value) is present. `cat2` (the `connect` value) is **absent**. The `connect` operation was discarded before it reached the database, exactly as the review's root cause describes (`toAssocs` in `packages/core/database/src/entity-manager/index.ts` returns `{ set: [...] }` and drops `connect`/`disconnect` as soon as `data.set` is truthy).

Raw capture: `step-2.get_article.readback.json`.

## Comparison with the original transcript

The original run (evidence `2026-08-14T15-18-58Z_4e4c9455`, failing step 21) recorded the same acceptance: HTTP 200, SSE tool result, no `isError`, `updatedAt` advanced from `...15:19:01.523Z` to `...15:19:01.573Z`. The original aborted at that step and therefore had **no** read-back, so the silent discard of `connect` was inferred from source. This re-verification adds the read-back and confirms the inference directly: the connected category is not on the document.

The scenario expected the body to contain `Input validation error: Invalid arguments for tool update_article`. It does not, on either run.

## Source state on the re-verified build

`packages/core/content-manager/server/src/mcp/schemas/data-schema.ts` still declares the to-many relation input as `z.object({ connect, disconnect, set }).strict()` with all three keys independently `.optional()` and no `.refine()` tying them together, and the `set` describe string still says "Mutually exclusive with connect/disconnect".

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`, and the read-back that the original run never reached confirms the second half of the finding (the `connect` is silently dropped, not merged).
