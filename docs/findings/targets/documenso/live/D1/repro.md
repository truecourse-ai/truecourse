# D1 live re-verification

**A sent (PENDING) document accepts new recipients, recipient edits, recipient deletes, field creates, field updates, field deletes and a title change.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00`, commit date 2026-08-19 20:34:18 +1000, tag **v2.17.0**. Same sha as `targets/STATE.md`.
- Started: `npm ci` then `npx turbo run build --filter=@documenso/remix`, then `npm run start -w @documenso/remix` with `PORT=3347`, database `tc_reverify_documenso` on the local Postgres 17.4. Health `GET /api/health` -> 200.
- Seeded by hand: owner `guard-owner@documenso.test` with team `guard-owner` and an API token, plus a source TEMPLATE envelope ("Guard Source Template", `internalVersion: 2`) holding `assets/example.pdf`, so `POST /api/v2/envelope/use` can mint a PDF-bearing envelope the way the scenario does.
- Auth on every call: `Authorization: <owner api token>` (verbatim, no `Bearer`). Redacted in the captures.

## Verdict

**still reproduces**, and wider than the original run could show. The original run stopped at step 7. Steps 8 to 12 had never been executed; four of the five are now executed, and three of them fail exactly as the review's source reading predicted.

## Run 1 (steps 1 to 14 of the capture; scenario steps 1 to 12)

`unique = e095c05f33`, envelope `envelope_zxidtommuuvcurfz`, recipient id `4`, field id `4`, envelope item `envelope_item_ruomtronircenbzi`.

| capture step | request | status | result |
|---|---|---|---|
| 1 | `POST /api/v2/envelope/use` (multipart, `payload={"envelopeId":"<template>","externalId":"tcref-frozen-e095c05f33"}`) | 200 | envelope minted |
| 2 | `POST /api/v2/envelope/update` `{envelopeId, meta:{signingOrder:"SEQUENTIAL", timezone:"Etc/UTC", dateFormat:"yyyy-MM-dd hh:mm a", language:"en"}}` | 200 | the draft accepts its settings |
| 3 | `POST /api/v2/envelope/recipient/create-many` (SIGNER, signingOrder 1) | 200 | recipient id 4 |
| 4 | `POST /api/v2/envelope/field/create-many` (SIGNATURE at 10/80) | 200 | field id 4 |
| 5 | `POST /api/v2/envelope/distribute` `{meta:{distributionMethod:"NONE"}}` | 200 | `{"success":true, ...signingUrl...}` |
| 6 | `GET /api/v2/envelope/<id>` | 200 | `status: "PENDING"`, recipient `signingStatus: "NOT_SIGNED"` |
| **7** | `POST /api/v2/envelope/recipient/create-many` on the PENDING envelope | **200** (expected 400) | a second SIGNER materialised: id `5`, `tcref-late-e095c05f33@documenso.test`, signing token `6ttkoIAnCaRFrYPO9sM2C`, `signingOrder: 2`, `sendStatus: "NOT_SENT"` |
| **8** | `POST /api/v2/envelope/recipient/update-many` `{data:[{id:4, email:"tcref-changed-e095c05f33@documenso.test"}]}` | **200** (expected 400) | the invited address of the already-invited signer was rewritten; the signing token stayed `f1sutPnzPFPjOaCKT0jZd`, so the link handed out at send time now belongs to a different address |
| **9** | `POST /api/v2/envelope/recipient/delete` `{recipientId:4}` | **200** (expected 400) | `{"success":true}`; the party the document was sent to is gone, and their SIGNATURE field went with them |
| 10 | `POST /api/v2/envelope/field/create-many` (recipient 4) | 400 | `Recipient 4 not found` — a 400 for the WRONG reason, collateral of step 9, not the freeze. Re-run cleanly below. |
| **11** | `POST /api/v2/envelope/item/delete` | **400** | `{"message":"Envelope item is not editable","data":{"code":"INVALID_REQUEST","httpStatus":400,"path":"envelope.item.delete"}}` — the only part of the freeze that IS enforced |
| **12** | `POST /api/v2/envelope/update` `{data:{title:"tcref-frozen-after-e095c05f33"}}` | **200** (expected 400) | the PENDING envelope was renamed; the read-back title is `tcref-frozen-after-e095c05f33` |
| 13 | `POST /api/v2/envelope/field/update-many` (field 4) | 404 | `Field with id 4 not found` — again collateral of step 9 |
| 14 | `GET /api/v2/envelope/<id>` | 200 | `status: PENDING`, recipients: only the late-added id 5, fields: `[]`, title: the renamed one |

Raw captures: `step-1.request.json` ... `step-14.response.json`.

## Run 2 (capture steps 15 to 24): the field freeze, tested cleanly

Because run 1's step 9 deleted the recipient, steps 10 and 13 could not tell the freeze from a dangling foreign key. Run 2 repeats the same setup and leaves the recipient alive.

`unique = c373a968c2`, envelope `envelope_daillesxfetczrhd`, recipient id `6`, signature field id `5`.

| capture step | request | status | result |
|---|---|---|---|
| 15-19 | mint, settings, recipient, SIGNATURE field, distribute NONE | 200 each | prepared |
| 20 | `GET /api/v2/envelope/<id>` | 200 | `status: "PENDING"` |
| **21** | `POST /api/v2/envelope/field/create-many` `{data:[{type:"TEXT", recipientId:6, page:1, positionX:40, positionY:40, width:20, height:5}]}` | **200** (expected 400) | field id `6` added to a document already out for signature |
| **22** | `POST /api/v2/envelope/field/update-many` `{data:[{id:5, type:"SIGNATURE", positionY:30}]}` | **200** (expected 400) | accepted (it changes nothing, see D2a, but it is not refused) |
| **23** | `POST /api/v2/envelope/field/delete` `{fieldId:5}` | **200** (expected 400) | `{"success":true}`; the signature field the recipient was invited to sign was removed from the sent document |
| 24 | `GET /api/v2/envelope/<id>` | 200 | `status: PENDING`, fields `[{id:6, TEXT, positionY:"40"}]`, recipients 1 |

Raw captures: `step-15.request.json` ... `step-24.response.json`.

## Comparison with the original transcript

The original run (`.truecourse/guard/evidence/2026-08-14T20-05-03Z_30d3cfc5/a-draft-accepts-changes-and-a-sent-document-refuses-them.api.1/transcript.txt`, v2.16.0) reached step 7 and stopped there with `expected: status 400 / actual: status 200`, having added recipient id 342 with token `9Pfx8Fnn0S32rwYhyOfL5` to a PENDING envelope. The live run on v2.17.0 reproduces that step byte-for-byte in shape (200, a fully materialised recipient with a fresh signing token, `sendStatus: NOT_SENT`) and then carries the scenario forward:

- Steps 8, 9 and 12 are newly observed and all return **200** where the docs and the scenario expect 400. The review inferred them from the identical two-gate shape in `update-envelope-recipients.ts`, `delete-envelope-recipient.ts`, `create-envelope-fields.ts` and `update-envelope-fields.ts`; they are now evidence, not inference.
- Step 10 is newly observed as **200** once the recipient is not deleted first (run 2 step 21). Field update and field delete on a PENDING envelope are also 200.
- Step 11 is the one refusal that works: `envelope.item.delete` answers 400 `Envelope item is not editable`. The PDF content freeze is enforced; the recipient and field freeze is not.

## What this changes for the finding

- Scope grows from "adds a recipient" to: **recipient create, recipient update, recipient delete, field create, field update, field delete and envelope rename are all accepted on a PENDING envelope**. Only `envelope/item/delete` is refused.
- Two consequences are worth stating in any filing because they were observed, not reasoned:
  - Step 8 rewrote the invited email while the **signing token was left unchanged**, so the link already handed to the original address keeps working and now resolves to a recipient carrying somebody else's address.
  - Step 9's delete **cascaded the recipient's SIGNATURE field away**, leaving a sent document that no longer has the field it was sent to collect. Run 2 step 23 reaches the same end state directly through `field/delete`.
- Step 12 (`envelope/update` on a PENDING envelope) is an extra doc violation the review recorded from the scenario but that had never run: `documents.md` says update only works on DRAFT documents.
- The review's caveat that steps 8 to 12 "have no runtime evidence and are source-level inference only" can be dropped.
