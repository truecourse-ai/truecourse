---
finding: S14
target: strapi/documentation
route: docs repo issue
title: "[Bug]: error-handling page swaps the descriptions of ForbiddenError and UnauthorizedError"
labels: type: bug
status: draft
reverified: yes (source and doc text re-checked 2026-08-19: strapi/strapi develop @ c7dbadd4feec41f0d3892c1bc9f5435e7aad3672 unchanged, strapi/documentation main @ 9226f90506a4a361038f220f24768016a73b5663 still carries both sentences; the 403 ForbiddenError body was observed again on Strapi 5.52.1 while re-running the neighbouring check)
---

# [Bug]: error-handling page swaps the descriptions of ForbiddenError and UnauthorizedError

## Link to the documentation page or resource

https://docs.strapi.io/cms/error-handling (Throwing errors > Default error classes, the "Forbidden" and "Unauthorized" tabs)

Source file: `docusaurus/docs/cms/error-handling.md`, line 407 and line 425 on `main` at `9226f90506a4a361038f220f24768016a73b5663`.

## Describe the bug

The two class descriptions are the wrong way round. In adjacent `TabItem` blocks the page says:

Line 407, "Forbidden" tab:

> The `ForbiddenError` class is a specific error class used when a user either doesn't provide any or the correct authentication credentials.

Line 425, "Unauthorized" tab:

> The `UnauthorizedError` class is a specific error class used when a user doesn't have the proper role or permissions to perform a specific action, but has properly authenticated.

- https://github.com/strapi/documentation/blob/9226f90506a4a361038f220f24768016a73b5663/docusaurus/docs/cms/error-handling.md#L407
- https://github.com/strapi/documentation/blob/9226f90506a4a361038f220f24768016a73b5663/docusaurus/docs/cms/error-handling.md#L425

**What the product does.** `packages/core/core/src/services/errors.ts` lines 4 to 29 map `errors.UnauthorizedError` to HTTP **401** and `errors.ForbiddenError` to HTTP **403**, the standard meanings: 401 for a caller who is not authenticated, 403 for a caller who is authenticated and refused.

https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/core/src/services/errors.ts#L4-L29

Core uses the classes that way too. `packages/core/admin/server/src/strategies/content-api-token.ts` lines 77 to 99 let a READ_ONLY token through only when every route scope ends in `find` or `findOne`, and otherwise `throw new ForbiddenError()`, that is a `ForbiddenError` for a caller who authenticated correctly and lacks the permission, exactly the case the page assigns to `UnauthorizedError`.

The page also contradicts itself. `PolicyError` extends `ForbiddenError` (`packages/core/utils/src/errors.ts` line 132), and line 276 of this same page already recommends `PolicyError` for "check if the user is allowed to perform the action". That advice only makes sense under the correct reading, two paragraphs above the inverted one.

**Observed.** On Strapi 5.52.0 (develop @ `c43e9ee1e20f613b63f8f10d9e52be062a8b4a72`, `yarn workspace getstarted start`, sqlite), a read-only Content API token:

```
GET  /api/articles              Authorization: Bearer <read-only token>   ->  200 OK
GET  /api/articles/<documentId> Authorization: Bearer <read-only token>   ->  200 OK
POST /api/articles              Authorization: Bearer <read-only token>
```

```
403 Forbidden
{"data":null,"error":{"status":403,"name":"ForbiddenError","message":"Forbidden","details":{}}}
```

`PUT` and `DELETE` answer the same. The token is valid and authenticated (the two reads prove it), the write is refused for lack of permission, and the class Strapi emits is `ForbiddenError`. Nothing is logged to stderr, so this is the deliberate authorization path.

**Re-verified on 2026-08-19.** `git log c43e9ee1e2..origin/develop` over `packages/core/core/src/services/errors.ts`, `packages/core/utils/src/errors.ts` and `strategies/content-api-token.ts` is empty, so the mapping is unchanged through 5.52.1, and both sentences are verbatim on `main`. The same `403 ForbiddenError` body was captured again on 5.52.1 while re-running the neighbouring REST error check.

**This is not a request to change a status code.** The wire behavior is HTTP-correct and this issue does not ask for it to change. strapi/strapi#9512 and #18782 cover the different, unauthenticated case (no credentials answering 403 rather than 401) and #18782 was closed as not planned; that question is out of scope here. The defect is only that the page attaches each description to the wrong class, so a developer writing a custom controller, policy or middleware from this page throws `UnauthorizedError` (401) for permission failures and `ForbiddenError` (403) for missing credentials, the opposite of what Strapi core emits, and a client branching on `error.name` per the page branches wrong.

## Suggested improvements or fixes

Swap the two descriptions, and state the status each class maps to, since `packages/core/core/src/services/errors.ts` is the authority and the page never mentions the mapping:

- Forbidden tab (line 407): "The `ForbiddenError` class is used when a caller is authenticated but lacks the role or permission required for the action. It maps to HTTP 403."
- Unauthorized tab (line 425): "The `UnauthorizedError` class is used when a caller provides no credentials or invalid credentials. It maps to HTTP 401."

The parameter tables and default messages below each sentence are correct and need no change.

## Additional context

One observation that belongs in the doc author's hands rather than in the fix: in a default install the public REST API answers `403` with `ForbiddenError` both for a request with **no** credentials and for a valid token without the permission, so the page's Forbidden / Unauthorized split does not describe two observable REST outcomes either way. Swapping the descriptions makes the page match the class semantics and the core code; describing when each status actually reaches the wire would be a further improvement.

## Related issue(s)/PR(s)

- strapi/documentation#2376 (closed as completed, 2025-02-20), "[Bug]: No Default error classes export from `@strapi/utils`". The only tracked bug against this section; it fixed the import example, not the class descriptions.
- strapi/strapi#9512 (closed 2022-02-01) and strapi/strapi#18782 (closed as not planned, 2025-11-03). Both about 401 versus 403 for unauthenticated requests, a different question, listed so this issue is not merged into them.
- No issue or PR in either repository reports the inverted descriptions. Searched 2026-08-19: `UnauthorizedError ForbiddenError` across the org (0 results), `ForbiddenError` in strapi/strapi (30 hits, all pre-existing and unrelated), plus a full enumeration of both repositories' recent issues.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
