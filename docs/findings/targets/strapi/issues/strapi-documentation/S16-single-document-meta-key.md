---
finding: S16
target: strapi/documentation
route: docs repo issue
title: "[Bug]: REST reference lists `meta` among the keys of a single document; the document object never carries it"
labels: type: bug
status: draft
reverified: yes (Strapi 5.52.1, develop @ c7dbadd4feec41f0d3892c1bc9f5435e7aad3672, live re-run 2026-08-19; docs re-checked on strapi/documentation main @ 9226f90506a4a361038f220f24768016a73b5663 the same day)
---

# [Bug]: REST reference lists `meta` among the keys of a single document; the document object never carries it

## Link to the documentation page or resource

https://docs.strapi.io/cms/api/rest (REST API reference > Requests, the "Requests return a response as an object" list)

Source file: `docusaurus/docs/cms/api/rest.md`, line 118 on `main` at `9226f90506a4a361038f220f24768016a73b5663`.

## Describe the bug

The list at lines 113 to 122 reads:

> - `data`: the response data itself, which could be:
>   - a single document, as an object with the following keys:
>     - `id` (integer)
>     - `documentId` (string), which is the unique identifier to use when querying a given document,
>     - the attributes (each attribute's type depends on the attribute, see [models attributes](/cms/backend-customization/models#model-attributes) documentation for details)
>     - `meta` (object)
>   - a list of documents, as an array of objects
>   - a custom response
>
> - `meta` (object): information about pagination, publication state, available locales, etc.

https://github.com/strapi/documentation/blob/9226f90506a4a361038f220f24768016a73b5663/docusaurus/docs/cms/api/rest.md#L113-L122

The `meta` bullet at line 118 is indented one level too deep, so it reads as a key of the single document object. The document object has no `meta` key, in any Strapi 5 response format. The correctly placed bullet is four lines below at line 122, so the page documents `meta` twice, once wrongly nested inside the document and once correctly as a sibling of `data`.

**What the product does.** `transformResponse` in `packages/core/core/src/core-api/controller/transform.ts` lines 39 to 71 is the single place that shapes every core content API response, and it returns exactly `{ data, meta }` with `meta` defaulting to `{}`. `data` is either the sanitized flattened entity (the Strapi 5 default) or, under the deprecated `strapi-response-format: v4` header, `transformEntry`'s `{ id, documentId, attributes }`. Neither branch attaches a `meta` key to an entry.

https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/core/src/core-api/controller/transform.ts#L39-L71

The bullet is a v4 carryover. In the v4 code the entry type declared an optional `meta?: Record<string, unknown>` and the return literally carried `// NOTE: not necessary for now  // meta: {}` commented out, so the key was aspirational even then; the flattening change of 2024 (strapi/strapi#19675) removed the vestigial field. The page's own JSON samples already agree with the product: every one of them shows `meta` beside `data`, never inside a document.

**Reproduced.** Build: Strapi 5.52.1, `strapi/strapi` develop @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, started with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start` (production start, not `strapi develop`), sqlite, node v24.14.1.

```
GET /api/articles/wfda6zuz7v941k6scpzzf47l
Authorization: Bearer <full-access Content API token>
```

```
200 OK

top-level keys : ["data", "meta"]
data keys      : ["id","documentId","title","blocksContent","markdownContent",
                  "authorName","slug","createdAt","updatedAt","publishedAt","locale"]
data.meta      : absent
meta           : {}
```

`meta` exists exactly once, as a sibling of `data`, and it is an empty object.

**Re-verified on 2026-08-19**, still reproduces, same shape as the first observation on 5.52.0 (`c43e9ee1e2`). `git log c43e9ee1e2..origin/develop -- packages/core/core/src/core-api/controller/transform.ts packages/core/core/src/core-api/controller/collection-type.ts` is empty, and the bullet is verbatim at line 118 on `main`.

Impact is developer friction rather than breakage: anyone typing the documented shape by hand, or generating a client or a TypeScript type from it, declares a per-document `meta` object that the REST API never emits.

## Suggested improvements or fixes

De-indent line 118 to the top level, or simply delete it, since line 122 already documents `meta` correctly as a sibling of `data`.

Wider suggestion for the same section: this list survived the v4 to v5 rewrite unaudited, so a pass of the whole "Requests" section against a live Strapi 5 response is warranted.

## Additional context

`docusaurus/docs/cms/api/rest.md` has a second, unrelated defect being reported separately: the 404 example at line 297 prints `"message": "Document not found"` where the API answers `Not Found`. Different cause, same file, so a maintainer may want to fix both in one PR.

## Related issue(s)/PR(s)

- strapi/documentation#924 (closed as completed, 2022-07-04), "[Bug]: No meta object in GET response". Same family of confusion but about the top-level pagination `meta` on a v4 GET, not the misplaced per-document bullet. Context only, not a duplicate.
- The line dates to commit `f28723fbb1` (2022-11-10, "Add REST API documentation"); the surrounding text was rewritten twice since (`9358b6c86` 2024-03-19, `eba970e24` 2025-02-06) and both rewrites carried the misplaced bullet through untouched.
- No open issue or PR reports it. Searched 2026-08-19: `meta object response document keys` (0 results), title search for `meta` in this repository (8 hits, only #924 relevant and closed since 2022), plus a full enumeration of this repository's issues since 2026-08-01 (40 items, none touching `rest.md`).

Found by TrueCourse running the published REST API reference against a live instance; the full transcript (requests, responses, server log) is available on request.
