# S16 live re-verification: the single document object carries no `meta` key

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`.
- **Seed:** the full-access content API token, and one published article created for this check (`POST /api/articles?status=published`, title `TC Live mt0ga1sw`, documentId `wfda6zuz7v941k6scpzzf47l`).
- **Verdict: still reproduces.**

## Step

```
GET /api/articles/wfda6zuz7v941k6scpzzf47l
Authorization: Bearer <full-access content API token, redacted>
```

`200 OK`. Structure of the body:

- top-level keys: `["data", "meta"]`
- `data` keys: `["id","documentId","title","blocksContent","markdownContent","authorName","slug","createdAt","updatedAt","publishedAt","locale"]`
- `data.meta` present: **false**
- top-level `meta`: `{}`

Raw capture: `step-1.get.single-document.json`.

`meta` exists exactly once, as a sibling of `data`, and it is an empty object. The document object itself has only `id`, `documentId` and the flattened attributes, so the REST reference's bullet listing `meta` (object) among the keys of the single document object names a key the product does not emit.

## Comparison with the original transcript

The original (evidence `2026-08-14T15-07-53Z_74b6e3f2`, failing step 1) recorded `{"data":{"id":2,"documentId":"oxu7drtrrz6081a4c0mcn43n","title":"Guard Published Article",...,"locale":"en"},"meta":{}}`. Same shape here, with a different document. The sibling assertion (`data` exists) passes in both runs.

## Source state on the re-verified build

`packages/core/core/src/core-api/controller/transform.ts` is unchanged from the tested build.

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`. Documentation drift against unchanged product behaviour.
