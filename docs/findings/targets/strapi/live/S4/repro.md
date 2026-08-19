# S4 live re-verification: every MCP create/update reply reports to-many relations as `[]`

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`.
- **Verdict: still reproduces.**

## Seed for this scenario

Same instance and admin token as S2 (`tcref-mcp-rel-mt0g5p53`). Categories `tcref-cat-one-mt0g5p53` = `xculmsrqzvdw9yfxlbhe47qb` and `tcref-cat-two-mt0g5p53` = `vl6ebvopem294co43mmqvvx2`, article `tcref-rel-mt0g5p53` = `b69aib6pqn0itpkibeuxot0p`.

## Steps

### 1. `create_article`: the reply for a document with no relations

```
POST /mcp {"jsonrpc":"2.0","id":101,"method":"tools/call","params":{
  "name":"create_article","arguments":{"data":{"title":"tcref-rel-mt0g5p53"}}}}
```

`200 OK`, reply carries `"categories":[]`. Correct here (there really are none), recorded as the baseline. Raw capture: `step-1.create_article.reply.json`.

### 2. `update_article` connecting one category

```
POST /mcp {"jsonrpc":"2.0","id":102,"method":"tools/call","params":{
  "name":"update_article",
  "arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p",
    "data":{"title":"tcref-rel-mt0g5p53",
            "categories":{"connect":["xculmsrqzvdw9yfxlbhe47qb"]}}}}}
```

`200 OK`, no `isError`, `updatedAt` = `2026-08-19T18:50:37.881Z`, and the reply says:

```json
"categories": []
```

Raw capture: `step-2.update_article.connect-cat1.reply.json`.

### 3. Read the same document back with `get_article`

```
POST /mcp {"jsonrpc":"2.0","id":103,"method":"tools/call",
           "params":{"name":"get_article","arguments":{"documentId":"b69aib6pqn0itpkibeuxot0p"}}}
```

`200 OK`, same `updatedAt` (`2026-08-19T18:50:37.881Z`, so nothing changed between the two reads), and:

```json
"categories": [{"documentId":"xculmsrqzvdw9yfxlbhe47qb","locale":"en"}]
```

The write landed. The write's own reply reported the opposite.

Raw capture: `step-3.get_article.readback.json`.

### 4. The same misreport on the two later writes in this session

| call | reply `categories` | `get_article` read-back |
|---|---|---|
| `update_article` with `{set:[cat1], connect:[cat2]}` (S2) | `[]` | `[{documentId: xculmsrqzvdw9yfxlbhe47qb, locale: en}]` |
| `update_article` with `{set:null}` (S3) | `[]` | `[{documentId: xculmsrqzvdw9yfxlbhe47qb, locale: en}]` |

Raw captures: `../S2/step-1.update_article.set-plus-connect.json`, `../S3/step-1.update_article.set-null.json` and their read-backs. Every write reply in the session reported `categories: []` while the document held one category.

## Comparison with the original transcript

The original run recorded the same thing at every `update_article` reply (steps 10, 12, 14, 16, 18, 19 and 21 of `2026-08-14T15-18-58Z_4e4c9455`), with `get_article` returning the truthful identity-only array. Identical behaviour here, over three writes.

## Source state on the re-verified build

`packages/core/content-manager/server/src/mcp/sanitizers/shape-relations.ts` and `.../mcp/handlers/collection-handlers.ts` are unchanged from the tested build: the write handlers still take the document-manager's count-shaped default populate, and `reduceToIdentity` still maps any non-array value to `[]`.

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`. This is the reply an MCP client sees immediately after its own write, and it is false in every write observed.
