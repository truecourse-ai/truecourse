# D15 live re-verification

**The docs say a token without access gets 403; cross-tenant reads answer 404 by design.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance: port 3347, database `tc_reverify_documenso`.
- Seed: two independent accounts, each with its own organisation, team and API token: owner `guard-owner@documenso.test` (team `guard-owner`) and outsider `guard-outsider@documenso.test` (team `guard-outsider`). Both tokens are valid and unexpired.

## Verdict

**still reproduces**, unchanged.

## Steps

1. `POST /api/v2/envelope/use` with the **owner** token -> **200**, envelope `envelope_utdishylsahhlhnw` created in the owner's team.
2. `GET /api/v2/envelope/envelope_utdishylsahhlhnw` with the **outsider** token -> **404**

   ```json
   {"message":"Envelope could not be found","code":"INTERNAL_SERVER_ERROR",
    "data":{"code":"NOT_FOUND","httpStatus":404,"path":"envelope.get",
            "appError":{"code":"NOT_FOUND","message":"Envelope could not be found"}}}
   ```

   The docs' authentication page says this case answers `403 Forbidden`. It answers 404, and the message denies the envelope exists at all.
3. Control: `GET` the same envelope with the **owner** token -> **200**. The envelope plainly exists; the 404 is an authorization answer, not a missing row.

Raw captures: `step-1.request.json` ... `step-3.response.json`.

## Comparison with the original transcript

The original run (v2.16.0) failed at its step 2 with `expected: status 403 / actual: status 404` and the identical body. Reproduced character for character on v2.17.0.

## What this changes for the finding

- Nothing. Verdict (doc bug, low impact, no data exposure) and confidence are unchanged.
- The control call in step 3 is a small addition worth keeping: it makes it unambiguous that 404 is the deliberate anti-enumeration answer rather than a lookup miss, which is the framing the research note asks a filer to use.
- The ask stays a documentation correction: change the authentication page's accordion to 404 and scope the FORBIDDEN row in `common-errors.mdx` to the licence-gated and CSC features that really do return 403.
