---
finding: D11, D12
target: documenso/documenso
route: comment on existing PR #3136
title: Wire capture confirming the string coordinates and the rejected create body on the fields page
labels: none (PR comment)
status: draft
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: D11 still reproduces, D12 not re-run live)
---

# Comment to post on https://github.com/documenso/documenso/pull/3136

Independent confirmation of both halves of the docs change in this PR, from a live instance rather than from source, plus a few things the current diff does not cover.

Tested against v2.16.0 (tag `v2.16.0`, `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source (`npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`) against Postgres 17.

**The coordinates really do come back as JSON strings.** This answers @dguyen's "Is this actually a string?" on the `positionX`/`positionY`/`width`/`height` rows with a wire capture instead of a code reading. Creating a signature field with numeric coordinates:

```
POST /api/v2/envelope/field/create-many
{"envelopeId":"envelope_ibilomevvhibyzka","data":[{"type":"SIGNATURE","recipientId":"335","page":1,"positionX":10,"positionY":80,"width":20,"height":5,"fieldMeta":{"type":"signature","required":true}}]}
```

HTTP 200, and `data[0]` reads:

```json
{"envelopeId":"envelope_ibilomevvhibyzka","envelopeItemId":"envelope_item_mccmxyybmnlzdwms","type":"SIGNATURE","id":301,"secondaryId":"cmstdmgo30007y60pmfgjxqyk","recipientId":335,"page":1,"positionX":"10","positionY":"80","width":"20","height":"5","customText":"","inserted":false,"fieldMeta":{"required":true,"overflow":"auto","type":"signature"},"documentId":345,"templateId":null}
```

Only the four Decimal-backed columns stringify. `page` (Int) comes back as the number `1` and `recipientId` as `335`, which is the cleanest evidence that this is the Prisma `Decimal` serialization and not a general numeric-stringification. The values are exact and lossless, just quoted, so retyping the rows to `string` in the docs is the right fix and a `Number` cast in `ZFieldSchema` would be a breaking change for existing v2 clients. Same run confirmed the `envelopeId` row this PR also retypes: the wire returns `"envelope_ibilomevvhibyzka"`, not a number.

**The documented create body really is rejected.** Posting the page's own curl body (with a real document id and recipient id substituted) against the URL the page prints for it:

```
POST /api/v2/envelope/field/create-many
{"documentId":"350","fields":[{"type":"SIGNATURE","recipientId":"339","pageNumber":1,"pageX":60,"pageY":85,"width":30,"height":5}]}
```

HTTP 400 before the handler is reached:

```json
{"message":"Input validation failed","code":"BAD_REQUEST","data":{"code":"BAD_REQUEST","httpStatus":400,"path":"envelope.field.createMany"},"issues":[{"code":"invalid_type","expected":"string","received":"undefined","path":["envelopeId"],"message":"Required"},{"code":"invalid_type","expected":"array","received":"undefined","path":["data"],"message":"Required"}]}
```

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): D11 still reproduces (D12 was not part of this live run). Coordinates sent as JSON numbers come back as strings, positionX "10", positionY "80", width "20", height "5", while page stays a number 1, the wire capture this PR's reviewer asked for.

**One observation that is not in the PR description and is worth adding to it.** The documented body is not invented: it is the live contract of the still-mounted legacy routes `POST /api/v2/document/field/create-many` and `/document/field/update-many`. `packages/trpc/server/field-router/schema.ts:36-65` defines exactly `{ documentId: z.number(), fields: [{ pageNumber, pageX, pageY, ... }] }` answering `{ fields: [...] }`, and `field-router/router.ts:131,213` still mounts them. Only the URL in the guide is wrong. That explains why the page reads plausibly and fails totally, and it means a reader who trusted it was not being careless. It also gives the maintainers a cheaper alternative if they prefer it: repoint the samples at the legacy `/document/field/*` URLs instead of rewriting the bodies. Rewriting to `envelopeId`/`data`, as this PR does, is the better fix, since the envelope routes are the documented-forward surface, but the choice is worth stating.

**Also worth knowing before merge:** the response half of the page is wrong independently of the request half. The envelope routes answer `{ data: [...] }` and the page prints `{ "fields": [...] }`, so even a reader who fixed the body by trial and error would still read the wrong key. This PR does change that too, in both the Create Fields and Update Fields sections, which is right.

**Three gaps this diff does not close.** They are small and could ride along or be split off:

1. Response examples with unquoted coordinates survive on other pages: `apps/docs/content/docs/developers/api/documents.mdx`, `apps/docs/content/docs/developers/getting-started/first-api-call.mdx` and `apps/docs/content/docs/developers/examples/common-workflows.mdx` all print field objects with numeric `positionX`/`positionY`/`width`/`height`. Request examples are correct as they stand and must stay numeric.
2. The response carries `fieldMeta.overflow: "auto"`, a default no doc example shows, even though the create sent only `{type, required}`.
3. The response also carries the backwards-compat keys `documentId` and `templateId` (`packages/lib/types/field.ts:46-49`), which the Field Object table does not list.

Both culprits are unchanged at today's head: `apps/docs/content/docs/developers/api/fields.mdx` and `packages/lib/types/field.ts` have no commits in `3cf2963cd0..origin/main`, so every line number in this PR's diff still applies against v2.17.0 (`75330166cc`), and the published page still types the coordinates `number` at https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/apps/docs/content/docs/developers/api/fields.mdx#L25-L28 while `ZFieldSchema` still passes the Prisma Decimals straight through at https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/packages/lib/types/field.ts#L31-L49 . Since #3133, #3134 and #3135 merged this morning, this branch is now based on `main` and can land on its own.

Found by TrueCourse running the published API docs against a live instance; the full transcript (requests, responses, server log) is available on request.
