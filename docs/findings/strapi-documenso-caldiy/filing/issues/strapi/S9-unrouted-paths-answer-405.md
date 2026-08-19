---
finding: S9
target: strapi/strapi
route: public issue
title: Any non-GET request to an unrouted path answers 405 with Allow HEAD, GET and a plain-text body, while GET on the same path answers 404 with the JSON error envelope
labels: none (BUG_REPORT.yml applies no automatic labels)
status: draft
reverified: yes (develop c7dbadd4fe / 5.52.1, 2026-08-19)
---

# Any non-GET request to an unrouted path answers 405 with Allow: HEAD, GET and a plain-text body, while GET on the same path answers 404 with the JSON error envelope

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

A path that no route declares is reported two different ways depending on the verb. `GET` gets `404` with Strapi's documented JSON error envelope. `DELETE`, `POST`, `PUT` and `PATCH` get `405 Method Not Allowed` with `Allow: HEAD, GET` and a `text/plain` body of `Method Not Allowed`. Both parts of the 405 are misleading. The `Allow` header is factually wrong, because `GET` on that same path is a 404 too, so nothing is actually allowed there. And the body is not the response shape the docs promise, so client code that calls `response.json()` or reads `error.status` breaks on it rather than surfacing a useful message.

The practical cost is a wrong diagnosis. A developer who mistypes a `pluralApiId`, or whose plugin or extension route failed to register, is told the URL is right and the verb is wrong, and goes looking for a method problem. That has happened at least four times in this tracker (#11756, #15024, #24197, #25019), each time closed as user confusion, and each time the router behavior that produced the misleading answer was left in place. This affects every non-GET method on every unrouted path in every Strapi application, not just the content API.

### What the docs say

https://docs.strapi.io/cms/api/rest, endpoints table and "Requests" section:

> | `DELETE` | `/api/:pluralApiId/:documentId` | Delete a document |

> Requests return a response as an object which usually includes the following keys:
> [...]
> - `error` (object, _optional_): information about any [error](/cms/error-handling) thrown by the request

https://docs.strapi.io/cms/error-handling, section "Receiving errors > REST errors":

> Errors thrown by the REST API are included in the [response](/cms/api/rest#requests) that has the following format:
>
> ```json
> {
>   "data": null,
>   "error": {
>     "status": "", // HTTP status
>     "name": "", // Strapi error name ('ApplicationError' or 'ValidationError')
>     "message": "", // A human readable error message
>     "details": {
>       // error info specific to the error type
>     }
>   }
> }
> ```

The REST reference does not state a status code for an unknown `pluralApiId`, so this report is not about 405 versus 404 as such. It is about the two answers disagreeing about the same URL, the `Allow` header naming a method that does not work, and the error body leaving the documented format.

### Observed

`DELETE /api/tcref-not-a-content-type/wfda6zuz7v941k6scpzzf47l`, a path no content type declares:

```
405 Method Not Allowed
Allow: HEAD, GET
Content-Type: text/plain; charset=utf-8

Method Not Allowed
```

`GET` on the exact same path, same instance, same token:

```
404 Not Found
Content-Type: application/json; charset=utf-8

{"data":null,"error":{"status":404,"name":"NotFoundError","message":"Not Found","details":{}}}
```

`POST /api/tcref-not-a-content-type` behaves like the DELETE: `405`, `Allow: HEAD, GET`, plain-text body. The verb does not matter as long as it is not GET or HEAD.

For contrast, on a real resource, `DELETE /api/articles` answers `405` with `Allow: HEAD, GET, POST`. There the status and the header are correct, since `/api/articles` really does serve those three methods. Only the body shape is off-contract in that case. The defect is specific to paths that match no route at all.

### Cause

`packages/core/core/src/middlewares/public.ts:26-35` (https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/core/src/middlewares/public.ts#L26-L35). The `strapi::public` middleware registers koa-static as a `GET` route whose path is the catch-all regexp `/((?!uploads/).+)` on the shared top-level Koa router, and `packages/core/core/src/services/server/index.ts:79` mounts that router as `app.use(router.routes()).use(router.allowedMethods())`. `@koa/router` 12.0.2 builds `allowedMethods` from `ctx.matched`, which is every layer whose path regexp matched, whether or not its handler ran. The public catch-all matches every path except `/uploads/...`, and its layer methods are `['HEAD','GET']`, so for a request with no route at all the allowed set is `{HEAD, GET}`, the request method is not in it, and `allowedMethods` sets `ctx.status = 405` with `Allow: HEAD, GET`. Setting the status explicitly also flips Koa's `ctx.response._explicitStatus`, which makes `strapi::errors` skip its `ctx.notFound()` fallback (`packages/core/core/src/middlewares/errors.ts:16-19`), and that fallback is exactly what produces the JSON envelope the GET on the same path receives. Hence 405 plus plain text instead of 404 plus the documented envelope.

Nothing recent introduced this. `git blame` puts the current lines on 38a7e3ce24 (PR #19270, 2024-01-19), but that commit only lifted the route out of the old `middlewares/public/index.ts`, where the identical catch-all already lived behind the `defaultIndex` flag. Issue #11756 reports the same 405 on a fresh Strapi v4.0.0 in 2021. Today's head is unchanged: https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/core/src/middlewares/public.ts#L26-L35 . The unmerged `chore/upgrade-koa-router-15` branch (commit 326ed84d77, 2026-08-07) rewrites the same line for path-to-regexp v8 but keeps it a GET route on the same router, so it would not change this.

Suggested fix: register the koa-static handler as plain app-level middleware, or on a method-agnostic layer, rather than as a GET router route, so an unrouted path stops advertising GET. Alternatively mount `allowedMethods` before the public middleware registers its catch-all. Either way, unrouted paths would fall through to `strapi::errors` and get the documented 404 envelope, and real resources would keep their truthful `Allow` headers.

### Related

- #11756 (closed): POST to a path with no matching route answers 405 on Strapi v4.0.0. Closed with no change to the public middleware.
- #15024 (closed): an unregistered user-permissions extension route surfaces as 405 on v4.5.1.
- #24197 (closed): plugin routes that failed to register after a 5.17 to 5.22 upgrade answer 405, so the reporter concluded the method was rejected.
- #25019 (closed): POST to `/admin/register-admin` answers 405 on 5.31.3. Closed the same day, unlabelled, no code change.

None of the four names the public catch-all or the `allowedMethods` interaction, so the underlying behavior has never been filed as such.

## Steps to Reproduce

Build tested: `strapi/strapi` `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19), run from source with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start` (production start, not `develop`), sqlite at `examples/getstarted/.tmp/data.db`. The instance reports 5.52.1 on node v24.14.1. The original run was on 5.52.0 @ `c43e9ee1e2`. Any Strapi 5 application reproduces it: a token is not required for the behavior, and the runs below simply carried a full-access content API token.

1. `DELETE /api/tcref-not-a-content-type/wfda6zuz7v941k6scpzzf47l` (any path with no route, any plausible id). Response: `405`, header `Allow: HEAD, GET`, `Content-Type: text/plain; charset=utf-8`, body `Method Not Allowed`.
2. `GET /api/tcref-not-a-content-type/wfda6zuz7v941k6scpzzf47l`, the same path. Response: `404`, `Content-Type: application/json`, body `{"data":null,"error":{"status":404,"name":"NotFoundError","message":"Not Found","details":{}}}`. The `Allow` header from step 1 is therefore wrong.
3. `POST /api/tcref-not-a-content-type` with any body. Same 405, same `Allow: HEAD, GET`, same plain-text body.
4. Contrast: `DELETE /api/articles`, a real collection route. Response: `405` with `Allow: HEAD, GET, POST`, which is truthful, and a plain-text body.

Re-verified on develop c7dbadd4fe (5.52.1) on 2026-08-19: still reproduces. Originally observed on 5.52.0 at c43e9ee1e2 with the same status and body; the `Allow` header value and steps 3 and 4 were captured in the re-run.

## Expected Behavior

A path that matches no route is reported the same way regardless of verb: `404` with the documented `{data: null, error: {status, name, message, details}}` envelope, the way `GET` already answers today. If a 405 is returned, the `Allow` header lists methods that actually work on that path, and the body follows the documented error format rather than Koa's default status text.

## Logs / Code Snippets

Server access log for the two requests on the same path:

```
DELETE /api/tcref-not-a-content-type/wfda6zuz7v941k6scpzzf47l (1 ms) 405
GET /api/tcref-not-a-content-type/wfda6zuz7v941k6scpzzf47l (2 ms) 404
```

Found by TrueCourse running the published REST API documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
