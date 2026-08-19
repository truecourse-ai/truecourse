# D5 live re-verification

**`fieldMeta` with `required: true` and `readOnly: true` is accepted by the API, and so is every other forbidden configuration the field-types page lists.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance: port 3347, database `tc_reverify_documenso`. Auth `Authorization: <owner api token>`, redacted.

## Verdict

**still reproduces**, and all nine forbidden configurations are now observed rather than one.

## Steps

Envelope `envelope_...` and recipient id in `unique.txt`; every case is a single `POST /api/v2/envelope/field/create-many` on the same DRAFT envelope, each expected 400 by the scenario.

| capture step | configuration | status | what was stored |
|---|---|---|---|
| 3 | TEXT `{type:"text", required:true, readOnly:true, text:"TCRef both"}` (the original failing step) | **200** | `{"required":true,"readOnly":true,"type":"text","text":"TCRef both"}` |
| 4 | TEXT `{type:"text", readOnly:true}` with no default text | **200** | `{"readOnly":true,"type":"text"}` |
| 5 | NUMBER `{type:"number", readOnly:true}` with no default value | **200** | `{"readOnly":true,"type":"number"}` |
| 6 | RADIO `{type:"radio", readOnly:true, values:[]}` | **200** | `{"readOnly":true,"type":"radio","values":[]}` |
| 7 | CHECKBOX `{type:"checkbox", readOnly:true, values:[{id:1,value:"A",checked:false}]}` | **200** | stored with nothing checked |
| 8 | DROPDOWN `{type:"dropdown", readOnly:true, values:[{value:"EU"}]}` with no default | **200** | stored |
| 9 | DROPDOWN `{values:[{value:"EU"},{value:"US"}], defaultValue:"APAC"}` | **200** | `defaultValue:"APAC"` stored, not among its own options |
| 10 | NUMBER `{value:"20", maxValue:10}` | **200** | stored, default above its maximum |
| 11 | NUMBER `{value:"1", minValue:10}` | **200** | stored, default below its minimum |

Steps 1 and 2 are the preparation (mint the envelope, add the recipient), both 200.

Every status and the exact stored `fieldMeta` for each case is in `cases.json`; the raw wire records are `step-1.request.json` ... `step-11.response.json`.

## Comparison with the original transcript

The original run (v2.16.0) failed at its step 3 with `expected: status 400 / actual: status 200` and then aborted, so the remaining eight cases were never executed. The live run reproduces step 3 identically (200, `fieldMeta` `{"required":true,"readOnly":true,"type":"text","text":"TCRef both"}`) and executes the other eight, all of which are also accepted.

## What this changes for the finding

- The review's caveat that "only the required+readOnly TEXT case was actually observed, the other eight are inference" can be dropped. All nine are observed on v2.17.0.
- The uniform 200 across nine unrelated rules is direct evidence for the root cause the review named: `createEnvelopeFields` does not call the per-type validators in `packages/lib/advanced-fields-validation` at all. This is not a per-rule gap; no `fieldMeta` validation runs on this path.
- A filing can now assert the blast radius as observed fact: TEXT, NUMBER, RADIO, CHECKBOX and DROPDOWN all accept configurations the field-types page states are impossible, and the invalid values are persisted on the field.
