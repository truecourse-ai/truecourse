---
finding: D4
target: documenso/documenso
route: public issue
title: After a 200 from POST /api/v2/envelope/recipient/{id}/reject the envelope is still PENDING, and other recipients can still act on it
labels: bug (template default; the repo's actual label is "type: bug")
status: filed
filed_url: https://github.com/documenso/documenso/issues/3287
filed_at: 2026-08-20
format_note: Body matches documenso bug-report.yml labels exactly, including the bracketed environment labels. No enforcing bot on this repo; matching keeps a triager oriented.
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: still reproduces)
---
### Issue Description

The lifecycle page says a rejection moves the document to Rejected immediately and that other pending recipients can no longer act on it. Neither holds at the moment the rejection returns. The rejection handler commits the recipient row and an audit log and nothing else; the document-level flip to `REJECTED` is written only by the asynchronous `internal.seal-document` job, after the whole PDF pipeline has run. The very next `GET /api/v2/envelope/{id}` still reports `"status": "PENDING"`.

The stale read is the visible half. The harm is the other half: every guard that stops the rest of the signing flow keys off `envelope.status === PENDING`. `sign-field-with-token` and `complete-document-with-token` check only that plus the acting recipient's own signing status, so for the whole window the other recipients can still sign or reject a document the product has already cancelled by email, since `send.document.cancelled.emails` is queued by the rejection request itself. If the seal job fails, and it demonstrably does (see #2921, #3092, #3191), the window never closes: the sweep job retries only between 15 minutes and 6 hours after the last recipient action and gives up after that.

#### Documentation

https://docs.documenso.com/docs/concepts/document-lifecycle, "Rejected":

> If you enable document rejection in settings, recipients can reject instead of signing. When any recipient rejects:
>
> * The document immediately moves to **Rejected** state
> * Other pending recipients can no longer act on the document
> * The document owner is notified

#### Cause

`rejectDocumentOnBehalfOf` commits exactly two rows in its transaction, the recipient (`signedAt`, `signingStatus: REJECTED`, `rejectionReason`) and a `DOCUMENT_RECIPIENT_REJECTED` audit log, then fires three jobs and returns: https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/packages/lib/server-only/document/reject-document-on-behalf-of.ts#L115-L177. It never touches `Envelope.status`; the only `DocumentStatus` reference in the file is the precondition `if (envelope.status !== DocumentStatus.PENDING)`.

The single writer of `DocumentStatus.REJECTED` in production code is `packages/lib/jobs/definitions/internal/seal-document.handler.ts`, which computes `finalEnvelopeStatus = isRejected ? REJECTED : COMPLETED` and writes it only after loading every envelope item's PDF, stamping the rejection, generating the certificate and audit-log PDFs, signing and uploading. With the default local job provider that job is dispatched over HTTP and explicitly not awaited (`packages/lib/jobs/client/local.ts` races the fetch against a 150 ms timeout), so the mutation returns long before the status changes.

The recipient-token path `reject-document-with-token.ts` has the identical shape, so this is the design of rejection rather than an API-only slip. The public API surface came with #3007 (2026-06-22, "feat: add API endpoint to reject documents on behalf of recipients"); the async design dates to #1472 (2024-11-14, "feat: signature rejection").

Still present at today's head, `75330166cc` (v2.17.0): https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/packages/lib/server-only/document/reject-document-on-behalf-of.ts#L115-L177. Both culprit files and the doc page are byte-identical to the tested v2.16.0.

Fix shape: write `Envelope.status = REJECTED` and the `DOCUMENT_REJECTED` webhook inside the same transaction that flips the recipient, and let the seal job produce only the stamped PDF. That closes the read-after-write gap, makes the "other recipients can no longer act" guard effective immediately, and removes the dependency of a terminal legal state on a PDF pipeline that can fail. If the asynchronous design is intended instead, the docs should say the status settles after sealing and point integrators at the `DOCUMENT_REJECTED` webhook, the way `developers/examples/common-workflows` already polls for a terminal status.

One thing that already works correctly and is worth documenting either way: recipient-level truth is immediate. The same GET payload already shows the rejecting recipient as `REJECTED` with the reason, so an integration can read the rejection off the recipient array before the envelope agrees.

#### Suggested labels

`type: bug`

#### Related

- #3191, "Rejecting an AES/QES envelope is a dead end: status never becomes REJECTED and cannot be recovered" (open since 2026-08-13, no comments): names the same single-writer root cause, but is scoped to the TSP/CSC case where the seal handler throws so the flip never happens at all. The ordinary non-TSP lag reported here is not covered by it.
- #3180, "Recipients who already signed can still reject, destroying their own signature" (open): a second missing guard on the same rejection path.
- #2921 and #3092 (open): two ways the seal job dies, leaving the envelope in PENDING forever.
- #2215 (closed): the completion twin, fixed with the sweep rather than a synchronous status write.
- #2563 (merged 2026-03-05): the seal-document sweep, the project's own mitigation for this class of stall; its query explicitly matches "any recipient has REJECTED". It runs 15 minutes to 6 hours after the last recipient action, so it cannot make "immediately" true.
- #3234 (closed unmerged, 2026-08-18): would have made the sweep cadence configurable, so that window is still fixed.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.

### Steps to Reproduce

Build tested: v2.16.0 (tag `v2.16.0`, `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source: `npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`, against Postgres 17, with `NEXT_PRIVATE_JOBS_PROVIDER=local`, `NEXT_PUBLIC_UPLOAD_TRANSPORT=database` and `NEXT_PRIVATE_SIGNING_TRANSPORT=local`. Every call carries a team API token: `Authorization: <token>`. Ids below are from the recorded run.

1. Create an envelope from a template: `POST /api/v2/envelope/use`, `Content-Type: multipart/form-data; boundary=tcguard`, payload part `{"envelopeId":"<template envelope id>","externalId":"tcref-reject-b99cc338a5"}`. 200, `{"id":"envelope_dswotmftyonlisrm","recipients":[]}`.

2. Add two signers, so the effect on a bystander is observable:

   ```
   POST /api/v2/envelope/recipient/create-many
   {"envelopeId":"envelope_dswotmftyonlisrm","data":[{"email":"tcref-declines-b99cc338a5@documenso.test","name":"TCRef Decliner","role":"SIGNER"},{"email":"tcref-other-b99cc338a5@documenso.test","name":"TCRef Other","role":"SIGNER"}]}
   ```

   200, recipients `360` and `361`.

3. Give each a signature field:

   ```
   POST /api/v2/envelope/field/create-many
   {"envelopeId":"envelope_dswotmftyonlisrm","data":[{"type":"SIGNATURE","recipientId":"360","page":1,"positionX":10,"positionY":70,"width":20,"height":5},{"type":"SIGNATURE","recipientId":"361","page":1,"positionX":10,"positionY":80,"width":20,"height":5}]}
   ```

   200.

4. Send it: `POST /api/v2/envelope/distribute` with `{"envelopeId":"envelope_dswotmftyonlisrm","meta":{"distributionMethod":"NONE"}}`. 200. (`NONE` only removes the need for a mail server.)

5. Reject on the first recipient's behalf:

   ```
   POST /api/v2/envelope/recipient/360/reject
   {"envelopeId":"envelope_dswotmftyonlisrm","recipientId":"360","reason":"tcref declined b99cc338a5"}
   ```

   200, recipient 360 comes back `"signingStatus":"REJECTED"`, `"rejectionReason":"tcref declined b99cc338a5"`, `"signedAt":"2026-08-14T20:05:31.134Z"`. The server log shows the request firing `internal.seal-document`, `send.signing.rejected.emails` and `send.document.cancelled.emails`.

6. Read the envelope back immediately: `GET /api/v2/envelope/envelope_dswotmftyonlisrm`. 200.

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): still reproduces. Reject returned 200 with signingStatus REJECTED on the recipient, but the envelope still read PENDING at 12 ms and at 112 ms after that 200, flipping to REJECTED at 52 ms in one run and 638 ms in another.

### Expected Behavior

Step 6 reports `"status": "REJECTED"`, and from step 5 onward recipient 361 can no longer sign or reject.

### Current Behavior

Step 6 returns `"status": "PENDING"` with `completedAt: null`, while the embedded recipients already read `360: REJECTED` and `361: NOT_SIGNED`:

```json
{"internalVersion":2,"type":"DOCUMENT","status":"PENDING","id":"envelope_dswotmftyonlisrm","secondaryId":"document_367","externalId":"tcref-reject-b99cc338a5","completedAt":null,"documentMeta":{"signingOrder":"PARALLEL","distributionMethod":"NONE", ...},"recipients":[{"role":"SIGNER","signingStatus":"REJECTED","id":360,"email":"tcref-declines-b99cc338a5@documenso.test","signedAt":"2026-08-14T20:05:31.134Z","rejectionReason":"tcref declined b99cc338a5", ...},{"role":"SIGNER","signingStatus":"NOT_SIGNED","id":361,"email":"tcref-other-b99cc338a5@documenso.test","signedAt":null,"rejectionReason":null, ...}], ...}
```

Step 5 took 299 ms and step 6 took 205 ms, so the read happened roughly 200 to 400 ms after the rejection. The cancellation emails to the owner and to recipient 361 had already been queued at that point.

Scope of the evidence: the transcript establishes only that the flip had not happened within that window; that the write is asynchronous, and therefore that the window has no documented bound, comes from the source, cited above. The recorded run stopped at this step, so the two follow-on assertions in the same flow (a rejected envelope refusing an update, and the second recipient being unable to reject) were never executed and carry no evidence either way.

### Operating System [e.g., Windows 10]

n/a (API, self-hosted from source)

### Browser [e.g., Chrome, Firefox]

n/a (API)

### Version [e.g., 2.13.0]

2.16.0 (tested; tag `v2.16.0` = `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), re-checked in source against 2.17.0 (`75330166cc00b29c14399bc2e391e4b4d8080c00`), where the culprit files and the doc page are byte-identical.

### Please check the boxes that apply to this issue report.

- [x] I have searched the existing issues to make sure this is not a duplicate.
- [x] I have provided clear steps to reproduce the issue.
- [x] I have included the relevant environment information.
- [x] I understand that this is a voluntary contribution and that there is no guarantee of resolution.
