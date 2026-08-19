# D2b live re-verification

**`POST /api/v2/envelope/field/update-many` wipes the field's `fieldMeta` to type defaults on any partial update.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance and auth: as for D2a (port 3347, database `tc_reverify_documenso`, owner API token in the `Authorization` header, redacted in the captures).
- Same run as D2a; the two halves are one request. The three relevant captures are copied here as `step-3.*`, `step-4.*` and `step-5.*`.

## Verdict

**still reproduces**, unchanged.

## Steps

Envelope `envelope_bxwelneerccdovmc`, recipient id `7`, field id `7`.

**step 3 — the field is created with the fields page's worked `fieldMeta` example**

Request body:
```json
{"envelopeId":"envelope_bxwelneerccdovmc","data":[{"type":"TEXT","recipientId":7,"page":1,"positionX":10,"positionY":20,"width":20,"height":5,
  "fieldMeta":{"type":"text","label":"Job Title","placeholder":"Enter your job title","required":true,"characterLimit":40,"textAlign":"left"}}]}
```
Response 200, `data[0].fieldMeta`:
```json
{"label":"Job Title","placeholder":"Enter your job title","required":true,"type":"text","characterLimit":40,"textAlign":"left"}
```

**step 4 — a partial update that never mentions `fieldMeta`**

Request body:
```json
{"envelopeId":"envelope_bxwelneerccdovmc","data":[{"id":7,"type":"TEXT","positionY":60}]}
```
Response 200, `data[0].fieldMeta`:
```json
{"label":"","placeholder":"","required":false,"readOnly":false,"fontSize":12,"type":"text","text":"","textAlign":"left"}
```

**step 5 — read back off the envelope**

`GET /api/v2/envelope/envelope_bxwelneerccdovmc` -> 200; the stored field carries the wiped meta, identical to the step 4 reply. The label, the placeholder, the required flag and the 40-character cap are gone from the database.

Raw captures: `step-3.request.json`, `step-3.response.json`, `step-4.request.json`, `step-4.response.json`, `step-5.request.json`, `step-5.response.json`.

## Comparison with the original transcript

The original run (v2.16.0) shows exactly the same before/after pair inside its step 4 response. The live run reproduces it on v2.17.0 with no difference at all.

## What this adds to the finding

- Confirms the research note: the schema and the write are unchanged, so v2.17.0 ships the silent data loss.
- The loss is silent in the strongest sense. The call returns **200** and the reply is a well-formed field object; only a caller who had recorded the previous `fieldMeta` can tell that four configured properties were destroyed.
- The docs' own update example, `{ id, type, pageY }`, is the shape of this call, so following the documentation is what triggers the wipe.
- The interaction with #3136 stands and matters: merging that PR makes the coordinate move work and leaves this wipe in place, so the loud symptom disappears while the quiet one survives.
