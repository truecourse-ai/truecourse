# D11 live re-verification

**Field coordinates are documented as `number` in responses; the wire sends JSON strings.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance: port 3347, database `tc_reverify_documenso`. Auth `Authorization: <owner api token>`, redacted.

## Verdict

**still reproduces**, verbatim.

## Steps

1. `POST /api/v2/envelope/use` -> **200**, envelope minted.
2. `POST /api/v2/envelope/recipient/create-many` (one SIGNER) -> **200**.
3. `POST /api/v2/envelope/field/create-many` with **numbers** on the wire:
   ```json
   {"envelopeId":"<envelope>","data":[{"type":"SIGNATURE","recipientId":<rid>,"page":1,
     "positionX":10,"positionY":80,"width":20,"height":5,"fieldMeta":{"type":"signature","required":true}}]}
   ```
   -> **200**. The response field object types (`wire-types.json`):

   | key | JSON type on the wire | value |
   |---|---|---|
   | `page` | number | `1` |
   | `positionX` | **string** | `"10"` |
   | `positionY` | **string** | `"80"` |
   | `width` | **string** | `"20"` |
   | `height` | **string** | `"5"` |

   The request sent numbers; the response returned strings for all four coordinate fields. `page` is the one that stays a number.

Raw captures: `step-1.request.json` ... `step-3.response.json`, plus `wire-types.json`.

## Comparison with the original transcript

The original run (v2.16.0) failed at its step 3 with `expected: json data[0].positionX equals 10 / actual: json data[0].positionX was "\"10\""`. The live capture is identical on v2.17.0.

## What this changes for the finding

- Nothing about the verdict: this remains a documentation bug, not a product defect. The strings come from Prisma `Decimal` serialisation.
- This is the wire capture that PR #3136's reviewer asked for: the author answered from source only. The `step-3.response.json` in this directory is a real response body showing all four coordinates as quoted strings while `page` is a number, which is the distinction the docs table gets wrong in one direction only.
- The research note's two extra doc gaps are unaffected by this run and still worth listing alongside it: the unquoted coordinates in the response examples on `documents.mdx`, `first-api-call.mdx` and `examples/common-workflows.mdx`, and the undocumented `fieldMeta.overflow` default plus the `documentId` / `templateId` compat keys the Field Object table omits. Both `documentId` and `templateId` are visible in the live response body.
