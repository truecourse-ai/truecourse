---
finding: D15
target: documenso/documenso
route: public issue
title: authentication.mdx says a token without access gets 403; cross-tenant reads answer 404 by design
labels: bug (bug-report.yml declares labels ['bug']; `type: documentation` is the fitting maintainer label)
status: draft
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: still reproduces)
---

# authentication.mdx says a token without access gets 403; cross-tenant reads answer 404 by design

## Issue Description

The Troubleshooting accordion on `apps/docs/content/docs/developers/getting-started/authentication.mdx` tells integrators that a token which lacks access to a resource gets `403 Forbidden`, and the Application Error Codes table on `apps/docs/content/docs/developers/api/common-errors.mdx` repeats it with a `FORBIDDEN` row. The v2 API answers `404 Not Found` in that situation, deliberately: resource reads are scoped by an ownership `where` clause, so a resource outside the token's user or team is indistinguishable from one that does not exist. That is the standard defence against resource-existence disclosure, and the function that implements it even carries a "Be extremely careful when modifying this function. Needs at minimum two reviewers" warning.

This is a documentation correction, not a security report. Nothing leaks and the outsider is correctly refused. The cost is diagnostic: an integrator who branches on 403 for permission problems sees 404 instead and concludes the envelope was deleted or the id is wrong, which is the hardest possible way to discover a cross-tenant misconfiguration.

Documenso's own docs already contradict the 403 claim, which is the strongest argument that the accordion is the wrong half. The per-endpoint status tables list 400/401/404/429/500 and never 403 (`fields.mdx` "404 | Document, recipient, or field not found", `recipients.mdx` "404 | Envelope or recipient not found", `first-api-call.mdx` "404 | Not found - resource doesn't exist"), and the error-handling switch in `examples/common-workflows.mdx` has no 403 branch.

Worth flagging for whoever picks this up: open PR #3139 edits this exact accordion and does not fix it. It rewrites the body sentence from "the token's account" to "the token's team" and keeps the "403 Forbidden" title, and its `common-errors.mdx` hunk keeps the `FORBIDDEN` row while adding `CSC_UNLICENSED` (403) beside it. So the lines have been read over twice without the status being noticed.

### Docs

https://docs.documenso.com/docs/developers/getting-started/authentication, Troubleshooting (`apps/docs/content/docs/developers/getting-started/authentication.mdx`, line 196 at today's head, https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/apps/docs/content/docs/developers/getting-started/authentication.mdx#L196-L198). The source renders the title with an em dash; it is reproduced here with a plain hyphen:

> 403 Forbidden - Token doesn't have access to the resource
>
> Ensure you're accessing resources owned by the token's account.

https://docs.documenso.com/docs/developers/api/common-errors, Application Error Codes (`apps/docs/content/docs/developers/api/common-errors.mdx`, line 23 at today's head):

> | `FORBIDDEN` | Access to the resource is denied (403). | Ensure your API key or user account has the necessary permissions and roles to execute this specific action. |

### Cause

The doc text is wrong, not the product.

An API token resolves to its own user and team (`packages/trpc/server/trpc.ts:98-135`: `ctx.user = apiToken.user`, `ctx.teamId = apiToken.teamId`). Every envelope read goes through `getEnvelopeWhereInput` (`packages/lib/server-only/envelope/get-envelope-by-id.ts:128-192`, https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/packages/lib/server-only/envelope/get-envelope-by-id.ts#L128-L192), which ANDs the envelope id with an OR of `userId = caller`, `teamId = caller's validated team with a matching visibility`, and "sent from the team email". A caller outside that set does not match the clause, `prisma.envelope.findFirst` returns `null`, and lines 82-86 throw `AppError` `NOT_FOUND`, which `app-error.ts` maps to HTTP 404.

`AppErrorCode.FORBIDDEN` (`packages/lib/errors/app-error.ts:82`, status 403) has no resource-ownership producer anywhere in the repo. Its only mapped 403 users are the licence gate (`packages/lib/server-only/license/assert-licensed-for.ts:36`) and `CSC_UNLICENSED`. So the documented 403 is unreachable for the case the accordion describes.

The accordion was written by PR #2460 "feat: docs v2" (`b92c53dbb2`, 2026-02-27); the `common-errors.mdx` FORBIDDEN row came later, in `7c0031679a` "docs: implement global error handling and troubleshooting matrix (#2784)", 2026-05-26. The behavior they describe is older and unchanged: the ownership-scoped query and its `NOT_FOUND` throw come from `7f09ba72f4` "feat: add envelopes (#2025)", 2025-10-14, which carried the pattern over from the pre-envelope document code. New doc text describing old behavior.

Still present at today's head: `git log 3cf2963cd0..origin/main` is empty for `get-envelope-by-id.ts` and for `common-errors.mdx`, and touches `authentication.mdx` only with the pre-review `<EnvelopeWarning />` banner commit (#3022, 2026-07-23), which shifted the accordion from line 194 to 196.

Suggested wording. Change the accordion to:

> 404 Not Found - the token's account has no access to that resource
>
> Resources outside the token's user or team are reported as `NOT_FOUND` rather than `FORBIDDEN`, so that the existence of another account's resources is not disclosed. Check that the token belongs to the team that owns the resource.

And in `common-errors.mdx`, keep the `FORBIDDEN` row but scope it to licence-gated and CSC features, which is its only producer, and add a line saying cross-account reads answer `NOT_FOUND`.

### Related

None. Tracker searches for "403 forbidden token access", "403" in title and "FORBIDDEN" (all including PRs) return nothing about 403 versus 404 on cross-tenant reads, and no item opened since 2026-08-10 concerns it either.

- #3139 "docs: fix workflows, authentication, error codes and id formats" (open) edits this exact accordion and keeps the wrong status, so it is the natural place to land the correction if the maintainers would rather amend that PR than track an issue.

## Steps to Reproduce

Tested on tag `v2.16.0` (`3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source (`npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`) against Postgres 17. Two accounts, each with its own team and its own API token.

1. As the owner, create an envelope (here from the account's own template, so that a PDF-bearing envelope exists):

```
POST /api/v2/envelope/use
Authorization: <owner token>
Content-Type: multipart/form-data; boundary=tcguard

--tcguard
Content-Disposition: form-data; name="payload"

{"envelopeId":"<template envelope id>","externalId":"tcref-outsider-1"}
--tcguard--
```

HTTP 200, `{"id":"envelope_fookcybfzrfktmht","recipients":[]}`.

2. Read that same envelope with the second account's token, which is perfectly valid and simply belongs to someone else:

```
GET /api/v2/envelope/envelope_fookcybfzrfktmht
Authorization: <outsider token>
```

HTTP 404:

```json
{"message":"Envelope could not be found","code":"INTERNAL_SERVER_ERROR","data":{"code":"NOT_FOUND","httpStatus":404,"path":"envelope.get","appError":{"code":"NOT_FOUND","message":"Envelope could not be found"}}}
```

The `path: "envelope.get"` in the body confirms the request passed the API-token middleware and reached the route, so this is the authorization outcome and not an authentication failure.

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): still reproduces. Outsider token on the owner's envelope answers 404 "Envelope could not be found" where the authentication page documents 403; a control call with the owner token returns 200 on the same envelope, so the 404 is the deliberate anti-enumeration answer rather than a lookup miss.

## Expected Behavior

The authentication troubleshooting entry and the `common-errors.mdx` FORBIDDEN row describe what the API does: a token whose account does not own the resource gets `404 Not Found` with the application code `NOT_FOUND`, and 403 is reserved for the licence gate. The docs should say so explicitly, including the reason, so that an integrator does not read a 404 as a wrong or deleted id.

## Current Behavior

The docs promise 403 Forbidden for a token without access. The API answers 404 with `data.code: "NOT_FOUND"`. No endpoint in the v2 surface produces 403 for resource ownership.

## Operating System

n/a (API, self-hosted from source)

## Browser

n/a (API, self-hosted from source)

## Version

2.16.0 (tested build). Re-checked in source against v2.17.0 (`75330166cc`, today's `main`): `get-envelope-by-id.ts` and `common-errors.mdx` have no commits since the tested tag, and the accordion is present verbatim at `authentication.mdx:196`.

Found by TrueCourse running the published API docs against a live instance; the full transcript (requests, responses, server log) is available on request.
