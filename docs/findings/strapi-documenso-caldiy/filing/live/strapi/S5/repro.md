# S5 live re-verification: `$null` / `$notNull` reject the boolean the rest of Strapi requires

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`.
- **Verdict: still reproduces**, including the inverted `$null: null` behaviour the review predicted but the original run never exercised.

## Seed for this scenario

Same instance and admin token as S2 (read, create and update on `api::article.article`). Three articles created through `create_article`, unique tag `opmt0g6lmy`:

| title | `authorName` |
|---|---|
| `tcref-opmt0g6lmy-alpha` | `TCRef-Writer` |
| `tcref-opmt0g6lmy-beta` | `tcref-writer` |
| `tcref-opmt0g6lmy-gamma` | (absent, so null) |

## Steps

### 1. `$null: true`, the shape the rest of Strapi requires

```
POST http://127.0.0.1:1347/mcp
Authorization: Bearer <admin token accessKey, redacted>
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":210,"method":"tools/call","params":{
  "name":"list_article",
  "arguments":{"filters":{"$and":[{"title":{"$contains":"opmt0g6lmy"}},
                                  {"authorName":{"$null":true}}]}}}}
```

`200 OK`, `isError: true`, text:

```
MCP error -32602: Input validation error: Invalid arguments for tool list_article: Invalid input at filters.$and[1].authorName
```

Raw capture: `step-1.list_article.null-true.json`.

### 2. `$notNull: true`, the other half

Same request with `{"authorName":{"$notNull":true}}` (id 211). Same result:

```
MCP error -32602: Input validation error: Invalid arguments for tool list_article: Invalid input at filters.$and[1].authorName
```

Raw capture: `step-2.list_article.notnull-true.json`. The original run never executed this step (the runner stops at the first failing step), so this is new observation, and it fails identically as the review said it would.

### 3. `$null: null`, which the advertised schema does accept

```
{"jsonrpc":"2.0","id":212,"method":"tools/call","params":{
  "name":"list_article",
  "arguments":{"filters":{"$and":[{"title":{"$contains":"opmt0g6lmy"}},
                                  {"authorName":{"$null":null}}]}}}}
```

`200 OK`, **no error**, and the result is:

```
total = 2
titles = ["tcref-opmt0g6lmy-alpha", "tcref-opmt0g6lmy-beta"]
```

Those are the two documents that **do** have an author name. A caller that asks for "author name is null" and stays inside the advertised schema is silently served `whereNotNull`, the exact opposite, with no error. Raw capture: `step-3.list_article.null-null.json`.

### 4. What the tool advertises for those two operators

From `tools/list`, the `list_article` input schema types `$null` and `$notNull` on the string field `authorName` as:

```json
{"anyOf": [{"type":"string"},
           {"type":"array","items":{"type":"string"}},
           {"type":"null"}]}
```

Boolean is not in the union, and `null` (which force-casts to `false` downstream) is. Raw capture: `step-4.tools-list.list_article.inputSchema.json`.

## Comparison with the original transcript

The original (evidence `2026-08-14T15-21-47Z_9ac34d71`, failing step 13) recorded the same `-32602 ... Invalid input at filters.$and[1].authorName` for `$null: true`. This re-verification reproduces that verbatim and adds two things the original run could not show: the `$notNull` half fails the same way, and the schema-legal `$null: null` returns the complement of what was asked.

## Source state on the re-verified build

`packages/core/content-manager/server/src/mcp/schemas/filters-schema.ts` still builds the operator object as `Object.fromEntries(FILTER_OPERATORS.map((op) => [op, valueSchema.optional()]))`, giving every operator the field's own value schema. Unchanged from the tested build.

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`. The rejection is unchanged and the inverted `$null: null` result is now observed rather than inferred, which strengthens the finding: the operator is not merely unusable, the one value the schema does accept is answered wrongly and silently.
