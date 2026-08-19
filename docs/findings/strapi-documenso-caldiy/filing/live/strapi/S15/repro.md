# S15 live re-verification: REST 404 says "Not Found" and 403 says "Forbidden", not the docs' wordings

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`.
- **Seed:** the full-access and read-only content API tokens minted at `POST /admin/api-tokens`.
- **Verdict: still reproduces.**

## Steps

### 1. `GET` an unknown documentId

```
GET /api/articles/tcrefmissingdocument0000
Authorization: Bearer <full-access content API token, redacted>
```

```
404 Not Found

{"data":null,"error":{"status":404,"name":"NotFoundError","message":"Not Found","details":{}}}
```

The docs' REST reference prints this 404 with `"message": "Document not found"`, and its sample omits `details` entirely. The wire says `Not Found` and carries `"details": {}`. Raw capture: `step-1.get.unknown-documentid.json`.

### 2. A write with the read-only token

```
POST /api/articles
Authorization: Bearer <read-only content API token, redacted>
{"data":{"title":"TC RO mt0ga1sw"}}
```

```
403 Forbidden

{"data":null,"error":{"status":403,"name":"ForbiddenError","message":"Forbidden","details":{}}}
```

The error-handling doc says the API returns the `ForbiddenError` class default, which is `Forbidden access`. The wire says `Forbidden`, the bare HTTP reason phrase. Raw capture: `step-2.post.read-only-token.json`.

### 3. Control: the read-only token still reads

```
GET /api/articles
Authorization: Bearer <read-only content API token, redacted>
```

`200 OK`. The token is valid and authenticated; only the write is refused, so this is the ordinary authorization path rather than a credential problem. Raw capture: `step-3.get.read-only-token.json`.

### 4. Control: no token at all

```
GET /api/articles
```

`403 Forbidden` with the same body, `{"data":null,"error":{"status":403,"name":"ForbiddenError","message":"Forbidden","details":{}}}`. Raw capture: `step-4.get.no-token.json`.

Worth recording alongside the S14 finding: the product answers the same class and the same status for "no credentials at all" and for "valid credentials without the permission", so the docs' split of `UnauthorizedError` / `ForbiddenError` across those two cases does not match either one.

## Comparison with the original transcript

Both halves match the original exactly.

- `a-missing-document-answers-the-documented-not-found-error.api.1` (failing step 3) recorded `{"data":null,"error":{"status":404,"name":"NotFoundError","message":"Not Found","details":{}}}`.
- `read-the-content-api-with-a-bearer-api-token.api.1` (failing step 3) and `a-read-only-api-token-reads-but-cannot-write.api.1` (failing step 7) recorded `{"data":null,"error":{"status":403,"name":"ForbiddenError","message":"Forbidden","details":{}}}`.

Byte-identical here.

## Source state on the re-verified build

`packages/core/core/src/middlewares/errors.ts` and `services/server/compose-endpoint.ts` are unchanged from the tested build, so the 404 still comes from the `ctx.notFound()` fallback and the 403 still discards the class message in favour of the status text.

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`. Both are documentation drifts against unchanged product behaviour.
