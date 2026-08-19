---
finding: S6
target: strapi/strapi
route: security disclosure
title: MCP tool errors return the raw database statement and its bound values to the client
labels: none (GHSA, no labels)
status: draft
reverified: yes (develop c7dbadd4fe / 5.52.1, 2026-08-19)
---

# MCP tool errors return the raw database statement and its bound values to the client

Private report via GitHub Security Advisories at https://github.com/strapi/strapi/security/advisories/new, the only intake channel SECURITY.md accepts. Nothing is attached; everything is inline below.

## Summary

When a Strapi MCP tool call fails with an error that is not an `errors.ApplicationError`, the MCP server hands the client the underlying driver error message verbatim. On knex, that message is the full SQL statement plus its bound values. An authenticated MCP client, including one holding a read-only Admin token, receives the physical table and column names, the internal numeric admin user id, and the literal parameter values of the failing statement. The same failure over Strapi's REST boundary is scrubbed to `{"status":500,"name":"InternalServerError","message":"Internal Server Error"}`, so this is not a general Strapi behaviour, it is the MCP boundary undoing what the REST boundary already does. The wrapper directly above the leaking code documents the opposite behaviour: its docblock promises the client "a safe error response (no stack trace leak)".

This is not a development-mode finding. The MCP server is gated by `server.mcp.enabled` (default `false`), not by `autoReload`: `McpConfiguration.isEnabled()` reads `server.mcp.enabled` and is the only gate on the server; `isDevMode()` reads `autoReload` and is consumed solely by `syncMcpSessionCapabilities` / `canUseMcpCapability` to widen which capabilities a session may use. The reproduction below was run under `strapi start`, not `strapi develop`. The published documentation states the same scope, at https://docs.strapi.io/cms/features/strapi-mcp-server:

> **Environment**
>
> Available in both Development & Production environment

and the configuration reference on that page lists exactly one activation switch:

> | `enabled` | Boolean | `false` | Enable or disable the MCP server. |

## Affected Versions

- Reproduced on 5.52.1 (`develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, 2026-08-19) and on 5.52.0 (`c43e9ee1e20f613b63f8f10d9e52be062a8b4a72`).
- The code was introduced by PR #26371 (`feat(*): introduce MCP server`, commit `9247b9b093`, merged 2026-05-27), so every v5 release carrying the MCP server is affected.
- Only instances that have opted in with `server.mcp.enabled: true` expose the surface. Both `strapi start` and `strapi develop` are affected.
- Unchanged on `develop` as of 2026-08-19: `git log c43e9ee1e2..origin/develop -- packages/core/core/src/services/mcp/tool-registry.ts` is empty.

## Vulnerability Details

`createErrorResult` in the MCP tool registry interpolates `error.message` into the tool result text with no check for whether the error is an `errors.ApplicationError` (a message meant for clients) or an internal one, and with no environment gate:

At the tested commit: https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/core/src/services/mcp/tool-registry.ts#L104-L113

On today's `develop` head, byte-identical: https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/core/src/services/mcp/tool-registry.ts#L104-L113

```ts
createErrorResult(error) {
  return { content: [{ type: 'text' as const,
                       text: `Tool "${name}" execution failed: ${error.message}` }],
           isError: true };
}
```

Three things make this a boundary problem rather than a formatting choice:

1. `wrapSafeHandler` (`packages/core/core/src/services/mcp/utils/safeHandlerWrapper.ts:5-12`) already logs the message and stack server-side, and its own docblock states what the client is supposed to get:

   > Errors are:
   > - Logged with full detail (message + stack) via Strapi's logger
   > - Returned to the MCP client as a safe error response (no stack trace leak)

   The registry defeats its own wrapper's contract.

2. Strapi's REST path does the opposite with the identical error. `packages/core/core/src/middlewares/errors.ts` falls through to `formatInternalError`, and `packages/core/core/src/services/errors.ts:64-76` replaces any non-exposed error with `createError(status || 500)`, so the raw driver message never leaves the server. This is confirmed on the wire in the proof of concept below.

3. The same verbatim echo exists in `packages/core/core/src/services/mcp/prompt-registry.ts:91` and `packages/core/core/src/services/mcp/resource-registry.ts:93`, so all three MCP capability kinds leak. A fix that only touches `tool-registry.ts` is partial.

Scope note on the trigger: the proof of concept induces `database is locked`, which is sqlite specific, but the disclosure is not. `createErrorResult` interpolates `error.message` for any error not converted upstream, and knex carries the statement plus its bindings in `error.message` on every driver, so a unique-constraint violation on PostgreSQL or MySQL discloses the same way.

## Proof of Concept

Build: `strapi/strapi` `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, instance reporting Strapi 5.52.1 on node v24.14.1. Started with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start` (that is `strapi start`, not `strapi develop`), sqlite at `examples/getstarted/.tmp/data.db`, `server.mcp.enabled: true`. Authentication is an Admin token with content-manager permissions on `api::article.article`.

Step 1, induce a write error. A second process takes an exclusive write lock on the same sqlite file and holds it across the two requests. Only the write path is affected; reads keep working.

```bash
mkfifo lock.fifo
sqlite3 examples/getstarted/.tmp/data.db < lock.fifo &   # reader kept open by the fifo
exec 3> lock.fifo
echo "BEGIN IMMEDIATE; SELECT 1;" >&3     # lock acquired and held
# ... the two requests below ...
echo "COMMIT;" >&3; exec 3>&-             # lock released
```

Step 2, an MCP write against the locked database:

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

It contains the full statement, the physical table and column names, and every bound value including the internal `created_by_id` / `updated_by_id` admin user id and the generated `document_id`.

Step 3, the same failure through REST, for contrast:

```
POST http://127.0.0.1:1347/api/articles
Authorization: Bearer <full-access content API token, redacted>
Content-Type: application/json

{"data":{"title":"tcref-lockmt0g7u7e-rest"}}
```

`500 Internal Server Error`:

```json
{"data":null,"error":{"status":500,"name":"InternalServerError","message":"Internal Server Error"}}
```

No SQL, no bindings, nothing beyond the status.

The original run on 5.52.0 @ `c43e9ee1e2` hit the same error incidentally and recorded the identical text apart from the values:

```
Tool "create_article" execution failed: insert into `articles` (`created_at`, `created_by_id`, `document_id`, `locale`, `published_at`, `title`, `updated_at`, `updated_by_id`) values ('2026-08-14 15:09:10.320', 2, 'nez829w0fwk50nas8b6n5df9', 'en', NULL, 'tcref-op-gamma-3d73b4faba', '2026-08-14 15:09:10.320', 2) returning `id` - database is locked
```

Re-verified on `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (Strapi 5.52.1) on 2026-08-19: still reproduces, and the REST comparison was captured in the same session.

## Impact

An authenticated MCP client learns internal database structure and statement parameters that the same failure never reveals over REST: physical table and column names, the internal numeric admin user id, and the literal bound values of the failing statement. The disclosure crosses the boundary the MCP permission model draws, because a token can be scoped narrowly (read only, or a subset of fields) and still receive statement text from a failing operation. Since `createErrorResult` echoes any non-`ApplicationError`, the leaked statement is whatever failed, which on an update or a constraint violation is not limited to the caller's own submitted values.

Two exclusions in SECURITY.md are worth addressing directly, since they are the closest neighbours to this report:

- "Banner, version, or stack disclosure on public surfaces without a demonstrated downstream exploit". This is not a banner or version string. It is per-request statement text with bound values, on a boundary whose whole purpose is scoped access, and the report is accompanied by a working reproduction rather than a description.
- CNA rule 4.1.2, conditions that do not lead to a security impact. The concrete impact is information disclosure to a client that Strapi's own permission model is designed to restrict, on the surface Strapi ships for autonomous AI clients, and the product already treats the same information as unsafe to return on its REST boundary.

If triage concludes this does not meet the bar as a vulnerability, the finding still stands as a correctness bug (the code contradicts its own wrapper's documented contract) and we will refile it as a public issue on that framing. Please say which you prefer rather than closing it silently.

Suggested fix: in `createErrorResult`, pass `error.message` through only for `errors.ApplicationError` instances and substitute a generic string otherwise, mirroring `formatInternalError`. Apply the same change to `prompt-registry.ts:91` and `resource-registry.ts:93`.

## Suggested CVSS 4.0

`CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N`

Low. `PR:L` because a valid Admin token is required (any scope, including read-only). `AT:P` because a failing write is required; the reproduction induces one with an external lock, and a caller can also provoke one through a constraint violation, but we did not capture that second path so we have not claimed it as attacker-controlled. `VC:L` because what leaks is schema detail, internal ids and statement parameters, not credentials or bulk content. Adjust as you see fit; the vector is offered as a starting point, not as a claim about severity.

## AI Usage Disclosure

AI tools were used in this report, at these stages:

- **Discovery.** The finding was produced by TrueCourse, an AI agent pipeline built on Anthropic Claude models. It derives executable scenarios from a product's own published documentation and runs them against a live instance. This defect surfaced while running the documented MCP filter operators against a Strapi instance built from source; the tool error was returned in the middle of that run.
- **Validation.** The re-run on 2026-08-19 against `develop` @ `c7dbadd4fe` (Strapi 5.52.1), including the deliberate sqlite lock and the REST contrast, was executed by the same agent pipeline under human direction.
- **Analysis.** Claude models were used to read the surrounding source (`tool-registry.ts`, `safeHandlerWrapper.ts`, `middlewares/errors.ts`, `services/errors.ts`, the MCP configuration gate) and to locate the introducing commit.
- **Drafting.** This report was drafted with AI assistance.

Human verification: a human reviewed and confirmed the reproduction, the captured request and response pairs, and the source references before this report was submitted. The proof of concept above is a transcript of a run that was executed, not a description of expected behaviour.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
