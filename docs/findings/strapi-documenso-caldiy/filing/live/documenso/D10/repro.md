# D10 live re-verification

**The documented v2 error format `{error, code, statusCode}` is never emitted; and every AppError-derived failure carries a top-level `INTERNAL_SERVER_ERROR`.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance: port 3347, database `tc_reverify_documenso`. Auth `Authorization: <owner api token>` where valid, redacted.

## Verdict

**still reproduces**, unchanged, on both halves.

## Steps

**1. Unknown envelope id** — `GET /api/v2/envelope/envelope_doesnotexist0000` -> **404**

```json
{"message":"Envelope could not be found","code":"INTERNAL_SERVER_ERROR",
 "data":{"code":"NOT_FOUND","httpStatus":404,"path":"envelope.get",
         "appError":{"code":"NOT_FOUND","message":"Envelope could not be found"}}}
```

Top-level keys: `message`, `code`, `data`. No `error`. No `statusCode`. The top-level `code` reads **`INTERNAL_SERVER_ERROR`** on a plain 404.

**2. A zod validation failure** — `POST /api/v2/envelope/update` with `{"notAField":1}` -> **400**

```json
{"message":"Input validation failed","code":"BAD_REQUEST",
 "data":{"code":"BAD_REQUEST","httpStatus":400,"path":"envelope.update"},
 "issues":[{"code":"invalid_type","expected":"string","received":"undefined","path":["envelopeId"],"message":"Required"}]}
```

Again no `error`, no `statusCode`. Here the top-level `code` is correct (`BAD_REQUEST`), because the zod path does not go through the AppError mapping.

**3. An invalid token** — the same GET with `Authorization: api_definitely_not_valid` -> **401**

```json
{"message":"Invalid token","code":"INTERNAL_SERVER_ERROR",
 "data":{"code":"UNAUTHORIZED","httpStatus":401,"path":"envelope.get",
         "appError":{"code":"UNAUTHORIZED","message":"Invalid token","statusCode":401}}}
```

Top-level `INTERNAL_SERVER_ERROR` again on a 401. Note that a `statusCode` does exist here, but nested three levels down inside `data.appError`, not at the top level where the docs put it.

Key-by-key summary in `keys.json`; raw wire records in `step-1.request.json` ... `step-3.response.json`.

## Comparison with the original transcript

The original run (v2.16.0) failed at its step 2 with `expected: json error to exist / actual: json error missing`, on the identical 404 body. The live run reproduces the body character for character and adds the 400 and 401 shapes, which show that:

- the missing `error` / `statusCode` keys are universal on the tRPC-backed v2 routes, not specific to 404, and
- the top-level `INTERNAL_SERVER_ERROR` rider appears on every AppError-derived failure (404, 401) but not on the zod path (400), which is the clean discriminator between the two halves of the finding.

## What this changes for the finding

- Nothing about the verdict. Both halves stand on v2.17.0.
- The 401 capture is a useful addition for a filing: it shows `statusCode` exists in the codebase and is emitted, just at `data.appError.statusCode` rather than at the top level the docs promise, so the doc fix is a re-shaping rather than an invention.
- The scope note from the research still applies: the hand-rolled Hono download routes do return `{error, code}`, so a filing must not claim "the API never returns `error`". Scope it to the tRPC-backed v2 surface and to `first-api-call.mdx`, which is the last page still publishing the invented envelope now that #3133 has corrected `rate-limits.mdx`.
