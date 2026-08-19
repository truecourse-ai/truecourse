# S6 live re-verification: raw SQL with bound values is echoed to the MCP client on a write error

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`.
- **Verdict: still reproduces.**

## How the write error was induced

The original run hit `database is locked` incidentally. Here it was induced deliberately, the way the brief suggests: a second process took an exclusive write lock on the same sqlite file and held it across the two requests.

```bash
mkfifo $SP/lock.fifo
sqlite3 examples/getstarted/.tmp/data.db < $SP/lock.fifo &   # reader kept open by the fifo
exec 3> $SP/lock.fifo
echo "BEGIN IMMEDIATE; SELECT 1;" >&3     # lock acquired and held
# ... the two requests below ...
echo "COMMIT;" >&3; exec 3>&-             # lock released
```

Nothing else about the instance was changed. Only the write path is affected; reads continued to work.

## Steps

### 1. An MCP write against the locked database

```
POST http://127.0.0.1:1347/mcp
Authorization: Bearer <admin token accessKey, redacted>
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":300,"method":"tools/call","params":{
  "name":"create_article","arguments":{"data":{"title":"tcref-lockmt0g7u7e-mcp"}}}}
```

`200 OK`, `isError: true`, and the text handed to the MCP client is, verbatim:

```
Tool "create_article" execution failed: insert into `articles` (`created_at`, `created_by_id`, `document_id`, `locale`, `published_at`, `title`, `updated_at`, `updated_by_id`) values ('2026-08-19 11:52:17.567', 1, 'cyimpmcud8qivqx73f5su8mv', 'en', NULL, 'tcref-lockmt0g7u7e-mcp', '2026-08-19 11:52:17.567', 1) returning `id` - database is locked
```

It contains the full statement, the column list, and every bound value including the internal `created_by_id` / `updated_by_id` admin user id and the generated `document_id`. Raw capture: `step-1.mcp.create_article.locked-db.json`.

### 2. The same failure through REST, for contrast

```
POST /api/articles
Authorization: Bearer <full-access content API token, redacted>
Content-Type: application/json

{"data":{"title":"tcref-lockmt0g7u7e-rest"}}
```

`500 Internal Server Error`:

```json
{"data":null,"error":{"status":500,"name":"InternalServerError","message":"Internal Server Error"}}
```

No SQL, no bindings, nothing beyond the status. Raw capture: `step-2.rest.post-api-articles.locked-db.json`.

So the same underlying driver error is scrubbed on the REST boundary and echoed in full on the MCP boundary.

## Comparison with the original transcript

The original (evidence `2026-08-14T15-07-53Z_74b6e3f2`, and the earlier run of the same scenario cited in the review) recorded:

```
Tool "create_article" execution failed: insert into `articles` (`created_at`, `created_by_id`, `document_id`, `locale`, `published_at`, `title`, `updated_at`, `updated_by_id`) values ('2026-08-14 15:09:10.320', 2, 'nez829w0fwk50nas8b6n5df9', 'en', NULL, 'tcref-op-gamma-3d73b4faba', '2026-08-14 15:09:10.320', 2) returning `id` - database is locked
```

The two texts are identical apart from the values. The REST contrast is new here and confirms the review's point that Strapi's own REST path already does the right thing with the same error.

Note on scope: the trigger (`database is locked`) is sqlite specific, but the disclosure is not. `createErrorResult` interpolates `error.message` for any error that is not converted upstream, and knex carries the statement plus bindings in `error.message` on every driver, so a unique-constraint violation on postgres or mysql discloses the same way.

## Source state on the re-verified build

`packages/core/core/src/services/mcp/tool-registry.ts` still has:

```ts
createErrorResult(error) {
  return { content: [{ type: 'text' as const,
                       text: `Tool "${name}" execution failed: ${error.message}` }],
           isError: true };
}
```

with no check for whether the error is an `errors.ApplicationError`. Unchanged from the tested build.

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`, and the REST comparison captured here sharpens it: this is not "Strapi leaks driver errors", it is "the MCP boundary leaks what the REST boundary already scrubs".
