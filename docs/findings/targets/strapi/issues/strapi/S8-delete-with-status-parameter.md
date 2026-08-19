---
finding: S8
target: strapi/strapi
route: public issue
title: DELETE /api/:pluralApiId/:documentId?status=draft answers 500, and ?status=published deletes the draft version too
labels: none (BUG_REPORT.yml applies no automatic labels)
status: draft
reverified: yes (develop c7dbadd4fe / 5.52.1, 2026-08-19)
---

# DELETE /api/:pluralApiId/:documentId?status=draft answers 500, and ?status=published deletes the draft version too

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

The Draft & Publish page says draft or published content can be deleted using the `status` parameter. The REST layer accepts the parameter on DELETE (`validateQuery` and `sanitizeQuery` both let it through, and `status` is explicitly picked into the Delete params type), but neither of its two legal values works. `?status=draft` throws a bare `Error` deep in the document service, which the Koa error middleware maps to a scrubbed `500 Internal Server Error`, so an integrator gets a response indistinguishable from a server crash for a documented parameter value. `?status=published` answers `204 No Content` and deletes every version of the document, including the draft the caller asked to keep. The first half wastes time and pollutes error logs; the second half loses data silently.

### What the docs say

https://docs.strapi.io/cms/features/draft-and-publish, section "Usage with APIs":

> Draft or published content can be requested, created, updated, and deleted using the `status` parameter through the various front-end APIs accessible from [Strapi's Content API](/cms/api/content-api).

### Observed

Part A, `?status=draft`. `DELETE /api/articles/qbod5ch6zve5z4o91xom1gce?status=draft` returns:

```
500 Internal Server Error
{"data":null,"error":{"status":500,"name":"InternalServerError","message":"Internal Server Error"}}
```

The document survives: a read-back with `?status=draft` still returns it, unchanged. The same parameter on the same document works on read (`?status=draft` finds it, `?status=published` does not) and on update (`PUT ... ?status=draft` applies the new title), so only DELETE rejects it.

Part B, `?status=published` on a document that has both versions. `DELETE /api/articles/l7bhxved9fbl8prawsq7tsy0?status=published` returns `204 No Content`, and afterwards both `GET ...?status=draft` and `GET ...?status=published` return 404. The version the parameter named was deleted, and so was the one it did not name.

### Cause

`packages/core/core/src/services/document-service/repository.ts:369-390` (https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/core/src/services/document-service/repository.ts#L369-L390). `deleteDocument` builds both its lookup query and its selection query with `omit('status')`, so the parameter never reaches the database query, and then guards with `if (hasDraftAndPublish && params.status === 'draft') { throw new Error('Cannot delete a draft document'); }`. Two things follow. First, the error type: this is a rejected user parameter, and every other input guard in this same file (lines 83, 111, 119, 137, 178, 190, 210, 287, 295) throws `errors.ValidationError`, which the HTTP layer maps to 400 with a readable message. A bare `Error` is not an `HttpError`, so the error middleware falls through to `formatInternalError` and the caller gets a scrubbed 500. Second, because `status` is omitted from `lookupQuery` and `transform/query.ts` adds no `publishedAt` condition (only `DP.statusToLookup` does, and `deleteDocument` does not call it), `published` is silently ignored and every version is deleted. Nothing upstream rejects the value either: the core API collection-type controller's delete (`packages/core/core/src/core-api/controller/collection-type.ts:106-114`) runs `validateQuery` then `sanitizeQuery`, and `status` is picked into the Delete params type at `packages/core/types/src/modules/documents/params/document-engine.ts:51-63`. So the product declares the parameter valid, accepts it at the edge, and then 500s on one of its two legal values while ignoring the other.

The guard arrived with the file in commit 5153a18c04 (PR #19665, merged 2024-03-05), which moved the Strapi 5 document-engine logic into `repository.ts`. The condition was later narrowed from `params.status === 'draft'` to `hasDraftAndPublish && params.status === 'draft'` by 79a590a581 (PR #25528, 2026-02-24), which touched the line and left the bare `Error` in place. Today's head is unchanged: https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/core/src/services/document-service/repository.ts#L369-L390

There is no test over this branch anywhere in the repository: the string `Cannot delete a draft document` appears exactly once in the tree, on the source line itself.

Suggested fix, in two parts. Line 389 should throw `errors.ValidationError`, matching the nine sibling guards in the same file, so a caller gets 400 plus the message instead of a scrubbed 500. Better still, reject the value in `validateParams` so it never reaches the service. And `published` should either scope the delete (unpublish semantics, keeping the draft) or be rejected the same way, so that the parameter is never silently dropped. There is a docs half as well, filed separately: the feature page's "and deleted" is not implementable as written while `omit('status')` stands, and the product's own detailed pages agree with the code, not with that sentence (the REST status page describes `status` purely as a query filter and never mentions delete, and the Document Service status page lists only `findOne`, `findMany`, `findFirst`, `count`, `create` and `update`).

### Related

No existing issue or PR covers either half. Searches for `Cannot delete a draft document`, `delete draft status parameter` and `status=draft` delete on strapi/strapi return nothing relevant.

## Steps to Reproduce

Build tested: `strapi/strapi` `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19), run from source with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start` (production start, not `develop`), sqlite at `examples/getstarted/.tmp/data.db`. The instance reports 5.52.1 on node v24.14.1. The original run was on 5.52.0 @ `c43e9ee1e2`. All requests carry a full-access content API token.

Part A, the 500:

1. `POST /api/articles?status=draft` with body `{"data":{"title":"DP API Status mt0g8fky","slug":"dp-api-status-mt0g8fky"}}` returns 201 with `publishedAt: null`. Note the `documentId`.
2. `GET /api/articles?status=draft&filters[slug][$eq]=dp-api-status-mt0g8fky` returns 200 with `meta.pagination.total: 1`, and the same request with `?status=published` returns `total: 0`. The parameter works as a read filter.
3. `PUT /api/articles/<documentId>?status=draft` with `{"data":{"title":"DP API Status mt0g8fky edited"}}` returns 200 and applies the title. The parameter works on update.
4. `DELETE /api/articles/<documentId>?status=draft` returns `500 Internal Server Error` with `{"data":null,"error":{"status":500,"name":"InternalServerError","message":"Internal Server Error"}}`.
5. `GET /api/articles/<documentId>?status=draft` returns 200: the call was a total no-op.

Part B, the silent extra delete:

6. `POST /api/articles?status=published` with body `{"data":{"title":"DP API Status Pub mt0g8fky","slug":"dp-api-status-pub-mt0g8fky"}}` returns 201 with a non-null `publishedAt`.
7. `GET /api/articles/<documentId>?status=draft` returns 200 with `publishedAt: null`, confirming a draft version exists alongside the published one.
8. `DELETE /api/articles/<documentId>?status=published` returns `204 No Content`.
9. `GET /api/articles/<documentId>?status=draft` returns 404, and `GET /api/articles/<documentId>?status=published` returns 404. Both versions are gone.

Re-verified on develop c7dbadd4fe (5.52.1) on 2026-08-19: both halves still reproduce. Part A was originally observed on 5.52.0 at c43e9ee1e2 with the identical response and log line; Part B was read from source at the time and is now observed on the wire.

## Expected Behavior

`status` either scopes a delete, as the Draft & Publish page states, or it is rejected as an invalid parameter for DELETE. Concretely: `?status=draft` deletes the draft version and answers 204, or answers 400 with `Cannot delete a draft document` as a `ValidationError`; `?status=published` deletes only the published version and leaves the draft in place, or answers 400. In no case should a documented, schema-accepted parameter value produce an opaque 500 with no message, and in no case should a version the caller explicitly excluded be deleted without a word.

## Logs / Code Snippets

Server log for the failing DELETE in step 4:

```
[2026-08-19 11:52:45.232] error: Cannot delete a draft document
Error: Cannot delete a draft document
    at deleteDocument (.../packages/core/core/dist/services/document-service/repository.js:273:19)
    ...
    at async CollectionTypeService.delete (.../core-api/service/collection-type.js:58:29)
[2026-08-19 11:52:45.232] http: DELETE /api/articles/qbod5ch6zve5z4o91xom1gce?status=draft (2 ms) 500
```

The 2 ms and the surviving document confirm the throw precedes the query, so nothing is deleted in this half.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
