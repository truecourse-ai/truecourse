---
finding: D1
target: documenso/documenso
route: security disclosure
title: A sent (PENDING) document still accepts new recipients through POST /api/v2/envelope/recipient/create-many
labels: none (private advisory, no labels)
status: draft
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: still reproduces)
---

# A sent (PENDING) document still accepts new recipients through POST /api/v2/envelope/recipient/create-many

Private report via the GitHub Security Advisory form at https://github.com/documenso/documenso/security/advisories/new, the primary channel named in SECURITY.md (fallback: security@documenso.com).

Affected versions: 2.16.0 (tested) and 2.17.0 (current release, code identical on this path). Self-hosted and cloud alike; the endpoint is the public v2 API.

## Summary

Three published pages state that a document is frozen once it moves to PENDING: recipients and fields cannot be added, changed or removed after the send. The server does not enforce that for the default signature level. On a distributed, PENDING envelope, `POST /api/v2/envelope/recipient/create-many` returns 200 and persists a new SIGNER with a fresh signing token. Any holder of a team API token can therefore add a signing party to a document the existing recipients already agreed to sign under a fixed party list; the added recipient is carried into the signing flow and onto the signing certificate. Under the default PARALLEL signing order the added signer is never emailed and still blocks completion, so the envelope cannot reach COMPLETED without manual intervention.

## Docs

https://docs.documenso.com/docs/developers/api/documents

> You cannot modify recipients or fields after a document moves to `PENDING` status.

https://docs.documenso.com/docs/concepts/document-lifecycle

> You cannot modify the document content, recipients, or fields while it is pending.

https://docs.documenso.com/docs/users/documents/add-recipients

> After sending a document, you cannot change recipients. If you need different recipients, you'll need to create a new document.

> You cannot remove recipients after the document has been sent.

## Reproduce

Build tested: v2.16.0 (tag `v2.16.0`, `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source: `npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`, against Postgres 17, with `NEXT_PRIVATE_JOBS_PROVIDER=local`, `NEXT_PUBLIC_UPLOAD_TRANSPORT=database`, `NEXT_PRIVATE_SIGNING_TRANSPORT=local`. Every call carries a team API token: `Authorization: <token>`. Ids below are the ones from the recorded run.

1. Create an envelope from a template (any PDF-bearing envelope works):

   `POST /api/v2/envelope/use`, `Content-Type: multipart/form-data; boundary=tcguard`, payload part `{"envelopeId":"<template envelope id>","externalId":"tcref-frozen-6f2f321c45"}`
   200, `{"id":"envelope_urehkhlnlvltdbhv","recipients":[]}`

2. `POST /api/v2/envelope/update`
   `{"envelopeId":"envelope_urehkhlnlvltdbhv","meta":{"signingOrder":"SEQUENTIAL","timezone":"Etc/UTC","dateFormat":"yyyy-MM-dd hh:mm a","language":"en"}}`
   200, `"status":"DRAFT"`

3. `POST /api/v2/envelope/recipient/create-many`
   `{"envelopeId":"envelope_urehkhlnlvltdbhv","data":[{"email":"tcref-frozen-6f2f321c45@documenso.test","name":"TCRef Frozen","role":"SIGNER","signingOrder":1}]}`
   200, recipient `id: 341`

4. `POST /api/v2/envelope/field/create-many`
   `{"envelopeId":"envelope_urehkhlnlvltdbhv","data":[{"type":"SIGNATURE","recipientId":"341","page":1,"positionX":10,"positionY":80,"width":20,"height":5}]}`
   200

5. Send it. `POST /api/v2/envelope/distribute`
   `{"envelopeId":"envelope_urehkhlnlvltdbhv","meta":{"distributionMethod":"NONE"}}`
   200, `{"success":true, ... "signingUrl":"http://localhost:51821/sign/<token>"}`
   (`NONE` is used only so the reproduction needs no mail server; the same result follows an email distribution.)

6. `GET /api/v2/envelope/envelope_urehkhlnlvltdbhv`
   200, `"status":"PENDING"`, recipient 341 `"signingStatus":"NOT_SIGNED"`

7. Add a second signer to the sent document. `POST /api/v2/envelope/recipient/create-many`
   `{"envelopeId":"envelope_urehkhlnlvltdbhv","data":[{"email":"tcref-late-6f2f321c45@documenso.test","name":"TCRef Late","role":"SIGNER","signingOrder":2}]}`
   200.

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): still reproduces, and wider than this original run showed. On the same PENDING envelope, recipient create-many, update-many, delete, field create-many, update-many, delete, and an envelope rename all returned 200; only envelope/item/delete was refused, with 400 "Envelope item is not editable".

## Observed

Step 7 returns HTTP 200 and the recipient is persisted with a working signing token:

```json
{"data":[{"envelopeId":"envelope_urehkhlnlvltdbhv","role":"SIGNER","readStatus":"NOT_OPENED","signingStatus":"NOT_SIGNED","sendStatus":"NOT_SENT","id":342,"email":"tcref-late-6f2f321c45@documenso.test","name":"TCRef Late","token":"<token>","documentDeletedAt":null,"expired":null,"expiresAt":null,"expirationNotifiedAt":null,"signedAt":null,"authOptions":{"accessAuth":[],"actionAuth":[]},"signingOrder":2,"rejectionReason":null}]}
```

The server log records the mutation as an ordinary success; stderr is empty.

## Expected

The call is refused and no recipient row is created, because the document is PENDING. No doc page publishes a status code for this refusal; 400 via `AppErrorCode.INVALID_REQUEST` matches the convention the same handler already uses for an unknown recipient.

Not observed, source-level inference only: the run stops at the first mismatch, so the sibling refusals in the same flow were never sent. `update-envelope-recipients.ts`, `delete-envelope-recipient.ts`, `create-envelope-fields.ts` and `update-envelope-fields.ts` carry the identical two-gate shape, so a recipient edit, a recipient delete and a field create or update on a PENDING envelope are expected to be accepted the same way. Those five paths should be checked together with the fix.

## Cause

`createEnvelopeRecipients` has exactly two state gates: https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/packages/lib/server-only/recipient/create-envelope-recipients.ts#L62-L74. Line 68 calls `assertEnvelopeMutable(envelope)`, and lines 70 to 74 reject only when `envelope.completedAt` is set. `assertEnvelopeMutable` (`packages/lib/server-only/envelope/assert-envelope-mutable.ts`) opens `assertSnapshotMutable` with `if (!isTspEnvelope(envelope)) { return; }`, so it is inert for a default SES envelope, and `completedAt` is null on a PENDING document. Nothing on the path compares `envelope.status` to `DocumentStatus.DRAFT`, and the transaction-scoped re-check further down is the same no-op. The `completedAt`-only gate is original to #1572 (2025-01-11, "feat: add template and field endpoints") and was carried onto the v2 endpoint by #2105 (2025-11-07, "feat: add envelopes api"); the `assertEnvelopeMutable` call that reads like a status guard came later, with #2874 (2026-06-16, "feat: add CSC AES/QES signing"), and is deliberately scoped to AES/QES.

Still present at today's head (75330166cc, tag v2.17.0): https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/packages/lib/server-only/recipient/create-envelope-recipients.ts#L62-L74. All six files on this path are byte-identical between v2.16.0 and v2.17.0.

The UI treats the freeze as real: `apps/remix/app/components/tables/documents-table-action-button.tsx` renders the Edit action only when the document is a draft. The natural fix is in the shared helper rather than per route: give `assertEnvelopeMutable` a mode that rejects any non-DRAFT status for authoring mutations regardless of signature level, keeping the AES/QES-specific `ENVELOPE_TSP_LOCKED` code and adding a plain `INVALID_REQUEST` for SES, then call it from the five authoring services. One legitimate exception must be preserved: `documentMeta.allowDictateNextSigner` lets a signer nominate the next recipient on a PENDING envelope (`complete-document-with-token.ts`).

## Related

- #3188, `setDocumentRecipients` and `setFieldsForDocument` delete already-signed recipients and fields: same family (authoring mutations past DRAFT), different path (v1 set-* replace endpoints).
- #3189, adding a recipient through API v1 recreates all the others: also about adding a recipient to an existing document, but it reports collateral destruction of the other recipients, not that a PENDING document accepts the addition.
- #3115, duplicate-email recipients collapse when resolving PDF placeholder tags: another recipient-creation bug on the same v2 surface, unrelated cause.
- #2215 (closed), envelope stuck in PENDING after all recipients signed: the symptom an added, never-notified signer produces, since completion requires every non-CC recipient to be SIGNED.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
