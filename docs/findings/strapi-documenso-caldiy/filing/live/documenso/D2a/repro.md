# D2a live re-verification

**`POST /api/v2/envelope/field/update-many` moves nothing: the route reads `page` / `positionX` / `positionY`, the service writes `pageNumber` / `pageX` / `pageY`.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0** (2026-08-19).
- Instance: built with `npm ci` + `npx turbo run build --filter=@documenso/remix`, served by `npm run start -w @documenso/remix` on port 3347 against Postgres database `tc_reverify_documenso`.
- Auth: `Authorization: <owner api token>` on every call, redacted in the captures.

## Verdict

**still reproduces**, and the live run is stronger than the original: not only does a partial update fail to move the field, a full update carrying every coordinate fails to move it too.

## Steps

`unique = 6c1e...` (see `unique.txt`), envelope `envelope_bxwelneerccdovmc`, recipient id `7`, field id `7`.

1. `POST /api/v2/envelope/use` (multipart `payload={"envelopeId":"<template>","externalId":"tcref-fieldmove-..."}`) -> **200**, envelope minted.
2. `POST /api/v2/envelope/recipient/create-many` `{envelopeId, data:[{email, name:"TCRef Signer", role:"SIGNER"}]}` -> **200**, recipient id 7.
3. `POST /api/v2/envelope/field/create-many` with the fields page's own worked example:
   ```json
   {"envelopeId":"envelope_bxwelneerccdovmc","data":[{"type":"TEXT","recipientId":7,"page":1,"positionX":10,"positionY":20,"width":20,"height":5,
     "fieldMeta":{"type":"text","label":"Job Title","placeholder":"Enter your job title","required":true,"characterLimit":40,"textAlign":"left"}}]}
   ```
   -> **200**. Stored: `"positionX":"10","positionY":"20"`, `fieldMeta` echoed intact.
4. **The move.** `POST /api/v2/envelope/field/update-many`
   ```json
   {"envelopeId":"envelope_bxwelneerccdovmc","data":[{"id":7,"type":"TEXT","positionY":60}]}
   ```
   -> **200**, and the reply carries `"positionY":"20"`. The coordinate asked for (60) is nowhere in the response.
5. `GET /api/v2/envelope/envelope_bxwelneerccdovmc` -> **200**. The stored field still reads `"positionX":"10","positionY":"20"`. The move did not happen in the reply and did not happen in the database.
6. **Control, not in the original scenario.** The same update repeated with every coordinate supplied, in case the drop only affects partial bodies:
   ```json
   {"envelopeId":"envelope_bxwelneerccdovmc","data":[{"id":7,"type":"TEXT","page":1,"positionX":10,"positionY":60,"width":20,"height":5}]}
   ```
   -> **200**, reply `"positionY":"20"`.
7. `GET /api/v2/envelope/...` -> the field is still at `"positionY":"20"`.

Raw captures: `step-1.request.json` ... `step-7.response.json`.

## Comparison with the original transcript

The original run (v2.16.0) failed at its step 4 with `expected: json data[0].positionY equals 60 / actual: json data[0].positionY was "\"20\""`. The live run on v2.17.0 produces the identical reply. The finding's research note ("nothing has touched the service, the route or the route types since v2.16.0, and v2.17.0 ships the same code") is confirmed on the wire.

## What this adds to the finding

- The no-op is not limited to partial bodies. Step 6 shows that a caller supplying `page`, `positionX`, `positionY`, `width` and `height` together still moves nothing, so there is no workaround through this endpoint and no way for an integrator to stumble into a working call.
- The defect is now live in two consecutive releases (v2.16.0 and v2.17.0).
- Open PR #3136 remains the exact fix for this half. Its sibling half, D2b, is unaffected by that PR and is reproduced from the same run.
