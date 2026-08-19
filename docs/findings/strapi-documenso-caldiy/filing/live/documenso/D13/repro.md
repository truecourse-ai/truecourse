# D13 live re-verification

**`POST /envelope/get-many` was documented as taking `{envelopeIds}`; it takes `{ids: {type, ids}}`.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance: port 3347, database `tc_reverify_documenso`. Auth `Authorization: <owner api token>`, redacted.

## Verdict

**fixed** (the documentation half). The product contract is unchanged and still rejects the old documented body, but the page that published it no longer does: PR #3135 merged on 2026-08-19 and is inside tag v2.17.0, which is the build under test.

## Steps

**1. The old documented body** — `POST /api/v2/envelope/get-many` `{"envelopeIds":["envelope_..."]}` -> **400**

```json
{"message":"Input validation failed","code":"BAD_REQUEST",
 "data":{"code":"BAD_REQUEST","httpStatus":400,"path":"envelope.getMany"},
 "issues":[{"code":"invalid_type","expected":"object","received":"undefined","path":["ids"],"message":"Required"}]}
```

Identical to the original run's failure.

**2. A wrong discriminator** — `{"ids":{"type":"envelopeIds","ids":[...]}}` -> **400**, `invalid_union_discriminator`. Recorded because it shows the discriminator is a closed set.

**4. The real contract** — `{"ids":{"type":"envelopeId","ids":["envelope_rskscwckoxdkimmd"]}}` -> **200**, `{"data":[{...envelope...}]}`.

(Step 3 mints the envelope used by step 4.) Raw captures `step-1.request.json` ... `step-4.response.json`, plus `note.txt`.

The live schema, read from `packages/trpc/server/envelope-router/get-envelopes-by-ids.types.ts` in the build under test, is a discriminated union on `type` with `envelopeId` (string ids), `documentId` and `templateId` (numeric ids), each 1 to 20 entries.

## The documentation in the build under test

`apps/docs/content/docs/developers/api/documents.mdx` at lines 806 to 852 now publishes:

```
| `ids`      | object | Yes | ID selector containing `type` and `ids`
| `ids.type` | string | Yes | `envelopeId`, `documentId`, or `templateId`
| `ids.ids`  | array  | Yes | 1-20 IDs: strings for `envelopeId`; numbers for `documentId` or `templateId`
```

with curl and TypeScript examples both sending `{"ids": {"type": "envelopeId", "ids": [...]}}`. Grepping the file for `envelopeIds` returns nothing. The corrected body, the 1-20 cap, the numeric `documentId` / `templateId` variants and a response section are all present, which is what the review recommended and what #3135 shipped.

## Comparison with the original transcript

The original run (v2.16.0) failed at its step 3 with `expected: status 200 / actual: status 400` when posting the documented `{envelopeIds}` body, with the same `path: ["ids"], message: "Required"` issue. That product behaviour is unchanged; only its documentation moved.

## What this changes for the finding

- Disposition changes from "unreported and open" to "fixed in release v2.17.0". Nothing should be filed.
- The review's characterisation of the defect and its recommended fix were both correct and are what shipped.
- Worth carrying into the report rather than a filing: three of the seven community docs PRs merged on 2026-08-19 (#3133, #3134, #3135), all approved on 2026-08-03 and merged 16 days later, so the "community docs PRs sit unmerged" narrative needs qualifying for Documenso.
