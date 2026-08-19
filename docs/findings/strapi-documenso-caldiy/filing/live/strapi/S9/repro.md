# S9 live re-verification: any non-GET request to an unrouted path answers 405 with `Allow: HEAD, GET` and a plain-text body

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`.
- **Seed:** the full-access content API token. One published article `wfda6zuz7v941k6scpzzf47l` supplies a plausible-looking documentId for the path.
- **Verdict: still reproduces.**

All requests carry `Authorization: Bearer <full-access content API token, redacted>`.

## Steps

### 1. `DELETE` on a path no content type declares

```
DELETE /api/tcref-not-a-content-type/wfda6zuz7v941k6scpzzf47l
```

```
405 Method Not Allowed
Allow: HEAD, GET
Content-Type: text/plain; charset=utf-8

Method Not Allowed
```

The body is Koa's default status text, not Strapi's JSON error envelope. Raw capture: `step-1.delete.unrouted-path.json`.

### 2. `GET` on the exact same path

```
GET /api/tcref-not-a-content-type/wfda6zuz7v941k6scpzzf47l
```

```
404 Not Found
Content-Type: application/json; charset=utf-8

{"data":null,"error":{"status":404,"name":"NotFoundError","message":"Not Found","details":{}}}
```

Raw capture: `step-2.get.same-unrouted-path.json`.

So the same non-existent resource is reported as absent to `GET` and as existing-but-wrong-method to `DELETE`, and the `Allow: HEAD, GET` header is factually wrong: `GET` on that path is a 404 too.

### 3. The verb does not matter

```
POST /api/tcref-not-a-content-type
{"data":{"title":"x"}}
```

```
405 Method Not Allowed
Allow: HEAD, GET

Method Not Allowed
```

Raw capture: `step-3.post.unrouted-path.json`. Any non-GET verb on any unrouted path gets the same treatment, so this is not specific to `DELETE`.

### 4. The contrast case, where 405 is the right answer

```
DELETE /api/articles
```

```
405 Method Not Allowed
Allow: HEAD, GET, POST

Method Not Allowed
```

Raw capture: `step-4.delete.collection-root.json`. Here `Allow` is truthful, since `/api/articles` really does serve GET, HEAD and POST. This is the review's note about step 4 of the original yaml: 405 with `Allow` containing GET and POST is the correct expectation there, and this run confirms the header is correct in that case and wrong in the unrouted case. The body is still plain text rather than the documented envelope in both.

## Comparison with the original transcript

The original (evidence `2026-08-14T15-07-53Z_74b6e3f2`, failing step 3) recorded `DELETE /api/tcref-not-a-content-type/kd5glmt3qd4fro8k5967nx8h (1 ms) 405` with the response body `Method Not Allowed`, and the sibling scenario's `GET` on the same shape of path returned the JSON 404 envelope. Identical here, with the `Allow` header value now captured explicitly (`HEAD, GET`) and steps 3 and 4 added, neither of which the original run reached.

## Source state on the re-verified build

`packages/core/core/src/middlewares/public.ts` still registers the koa-static handler as a `GET` route on the catch-all regexp on the shared top-level router, and `services/server/index.ts` still mounts `router.allowedMethods()` after it, so `ctx.matched` always contains the public layer and `allowedMethods` derives `{HEAD, GET}` for a request with no route. Unchanged from the tested build.

## Verdict

**still reproduces** on 5.52.1 @ `c7dbadd4`.
