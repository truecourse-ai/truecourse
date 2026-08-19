---
finding: S15
target: strapi/documentation
route: docs repo issue
title: "[Bug]: REST reference and error-handling page print error messages the API never returns (404 Document not found, 403 default message)"
labels: type: bug
status: draft
reverified: yes (Strapi 5.52.1, develop @ c7dbadd4feec41f0d3892c1bc9f5435e7aad3672, live re-run 2026-08-19; docs re-checked on strapi/documentation main @ 9226f90506a4a361038f220f24768016a73b5663 the same day)
---

# [Bug]: REST reference and error-handling page print error messages the API never returns (404 Document not found, 403 default message)

## Link to the documentation page or resource

- https://docs.strapi.io/cms/api/rest (REST API reference > Requests > Get a document, the 404 response tab)
- https://docs.strapi.io/cms/error-handling (Throwing errors > Default error classes, the "Forbidden" tab note)

Source files on `main` at `9226f90506a4a361038f220f24768016a73b5663`: `docusaurus/docs/cms/api/rest.md` line 297, and `docusaurus/docs/cms/error-handling.md` line 418.

## Describe the bug

Two places document an `error.message` string that the REST API has never emitted. Same underlying pattern, two different causes, so they are listed as two numbered items.

### 1. rest.md line 297: the 404 for `GET /api/:pluralApiId/:documentId`

The page prints:

```json
{
  "data": null,
  "error": {
    "status": 404,
    "name": "NotFoundError",
    "message": "Document not found"
  }
}
```

https://github.com/strapi/documentation/blob/9226f90506a4a361038f220f24768016a73b5663/docusaurus/docs/cms/api/rest.md#L289-L299

The wire says `"message": "Not Found"`, and the body also carries a `"details": {}` member the sample omits. The component wrapping this very sample already says the right thing: line 289 is `<ResponseTab status={404} statusText="Not Found">`.

**What the product does.** No controller raises this 404, so there is no controller-chosen message to quote. The core-api `findOne` passes a nil result through `transformResponse` unchanged, `returnBodyMiddleware` assigns no body, `ctx.response._explicitStatus` stays false, and `packages/core/core/src/middlewares/errors.ts` lines 17 to 19 take `if (!ctx.response._explicitStatus) return ctx.notFound();`. `ctx.notFound` defaults its response argument to `statusName`, which is `STATUS_CODES[404]`, that is `Not Found`.

https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/core/src/middlewares/errors.ts#L17-L19

The `"NotFoundError"` in the body is `http-errors`' own class name for 404, not the `@strapi/utils` class, which is never constructed on this path (its default message is `Entity not found`). This behavior dates to 2021 and is unchanged.

### 2. error-handling.md line 418: the 403 message note

The page says:

> The custom `message` passed to `ForbiddenError` is not included in the API response. Instead, the API returns the default message. If you need to return a custom error message indicating insufficient permissions, use [`PolicyError`](#policies) instead.

https://github.com/strapi/documentation/blob/9226f90506a4a361038f220f24768016a73b5663/docusaurus/docs/cms/error-handling.md#L416-L420

The suppression is real and intended. What is wrong is which string replaces the custom one. The class default is `Forbidden access` (shown in the table at line 411 of the same page); the API returns `Forbidden`, the bare HTTP reason phrase.

**What the product does.** `packages/core/core/src/services/server/compose-endpoint.ts` lines 41 to 55 catch the thrown `ForbiddenError`, re-throw only `PolicyError`, and otherwise `return ctx.forbidden();`, discarding the thrown instance entirely. The koa helper defaults its response argument to `statusName`, `STATUS_CODES[403]`, that is `Forbidden`, and `formatHttpError` writes that into `error.message`.

https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/core/src/services/server/compose-endpoint.ts#L41-L55

The note is also broader than the behavior: the discard happens in the route authentication and authorization path. A `throw new errors.ForbiddenError('custom')` from a controller, service or lifecycle is an `ApplicationError` and its custom message **is** serialized into `error.message`.

### Reproduced

Build: Strapi 5.52.1, `strapi/strapi` develop @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, started with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start` (production start, not `strapi develop`), sqlite, node v24.14.1.

1. `GET /api/articles/tcrefmissingdocument0000` with a full-access Content API token:

```
404 Not Found
{"data":null,"error":{"status":404,"name":"NotFoundError","message":"Not Found","details":{}}}
```

2. `POST /api/articles` with a read-only Content API token, body `{"data":{"title":"TC RO"}}`:

```
403 Forbidden
{"data":null,"error":{"status":403,"name":"ForbiddenError","message":"Forbidden","details":{}}}
```

3. Control: `GET /api/articles` with the same read-only token answers `200`, so the 403 is the ordinary authorization path and not a credential problem.

**Re-verified on 2026-08-19**, still reproduces, byte-identical to the first observation on 5.52.0 (`c43e9ee1e2`). `git log c43e9ee1e2..origin/develop` over `middlewares/errors.ts` and `services/server/compose-endpoint.ts` is empty, and both doc lines are verbatim on `main`.

**The direction of the fix is settled by a maintainer.** On strapi/strapi#18673, the community PR that tried to make `ForbiddenError` and `UnauthorizedError` return their messages, `innerdvations` wrote on 2024-03-26: "I also believe that this is intended behavior to suppress those specific error messages. However, I do agree we need some way to do this, which we currently don't have." The PR was closed unmerged. So the code is deliberate and the documentation is the side that should change.

## Suggested improvements or fixes

**rest.md line 297:** change `"message": "Document not found"` to `"message": "Not Found"`, matching the surrounding component's own `statusText` prop, and add `"details": {}` to the sample so it matches the real body. Apply the same substitution anywhere else the page shows a core REST 404.

Worth telling the doc author why this is easy to get wrong: the product carries three 404 wordings for the same conceptual failure, and only the first is reachable through `/api/:pluralApiId/:documentId`.

- public REST core-api: `Not Found` (the `ctx.notFound()` fallback)
- content-manager admin API and MCP handlers: `Document not found`
- the bare `@strapi/utils` `NotFoundError` default, documented on /cms/error-handling: `Entity not found`

**error-handling.md line 418:** replace "Instead, the API returns the default message" with something like:

> Instead, the API returns the generic HTTP status text (`Forbidden`). This suppression applies to a `ForbiddenError` raised during route authentication and authorization; a `ForbiddenError` thrown from a controller, service or lifecycle keeps its message.

If Strapi would rather make the docs true than change them, the alternative for the 403 is one line in `compose-endpoint.ts` (pass the class default through, which leaks no caller-supplied text), and for the 404 it is having core-api `findOne` throw `errors.NotFoundError('Document not found')` instead of leaning on the "no handler set a body" fallback. Both are wire-visible changes to long-standing behavior, so they are semver decisions rather than bug fixes. Correcting the documentation is the cheap and safe option, and the maintainer comment above points the same way.

## Related issue(s)/PR(s)

- strapi/strapi#18672 (closed as completed, 2023-11-08), "UnauthorizedError and ForbiddenError don't return error's message and details data". Reports the identical 403 body; closed without the message part ever being addressed.
- strapi/strapi#18673 (closed unmerged, 2024-09-18), "Fixing #18672: return message for unauthorized and forbidden". Carries the maintainer comment quoted above confirming the suppression is intended.
- strapi/strapi#19374 (merged 2024-02-09), "enhancement: make policy error public". Added the `PolicyError` carve-out in `compose-endpoint.ts`, further evidence the discard is deliberate.
- strapi/strapi#25424 (merged 2026-06-25), "feat(ts): augment all context error response methods". Kept `response = statusName` as the default, so the `Forbidden` and `Not Found` strings are now pinned by a sync test.
- strapi/documentation#3341 (merged 2026-07-21), "Redesign API reference Endpoint components". Moved the 404 example into the `<ResponseTab>` component and carried "Document not found" across verbatim. Not the origin: the string was added by commit `5ae56cbd02` on 2026-04-04.
- No open issue or PR reports either wording. Searched 2026-08-19 across both repositories, including a full enumeration of recent issues.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
