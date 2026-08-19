# D4 live re-verification

**`POST /api/v2/envelope/recipient/{id}/reject` returns 200; the next `GET` of the envelope still says PENDING.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance: port 3347, database `tc_reverify_documenso`, `NEXT_PRIVATE_JOBS_PROVIDER=local`, `NEXT_PRIVATE_SIGNING_TRANSPORT=local` with `./example/cert.p12`, a local SMTP sink on 127.0.0.1:2500. Auth `Authorization: <owner api token>`, redacted.

## Verdict

**still reproduces.** The read taken immediately after the 200 shows `PENDING`, exactly as in the original run. The window is shorter on this machine than on the original one, so the finding should be stated as "the status is written asynchronously and the immediate read is stale", not as "the status never arrives".

## Run 1 (capture steps 1 to 9): the scenario, with a scheduled poll

Envelope `envelope_nfbbhctvneaaadxv`, decliner recipient id `10`, second signer id `11`.

1. `POST /api/v2/envelope/use` -> 200.
2. `POST /api/v2/envelope/recipient/create-many` with two SIGNERs -> 200 (ids 10 and 11).
3. `POST /api/v2/envelope/field/create-many` with a SIGNATURE field each -> 200.
4. `POST /api/v2/envelope/distribute` `{meta:{distributionMethod:"NONE"}}` -> 200.
5. `POST /api/v2/envelope/recipient/10/reject` `{envelopeId, recipientId:10, reason:"tcref declined 1f36da77c3"}` -> **200**, body `{"id":10,"signingStatus":"REJECTED","rejectionReason":"tcref declined 1f36da77c3", ...}`. Returned at `2026-08-19T19:16:11.378Z`.
6. `GET /api/v2/envelope/<id>` **112 ms after that 200** -> 200, and the envelope reads:
   - `status: "PENDING"` (the docs say the rejection moves the document to Rejected immediately)
   - `recipients[0].signingStatus: "REJECTED"`, `rejectionReason: "tcref declined 1f36da77c3"`
   The recipient-level truth is already there; the envelope-level truth is not.
7. `GET /api/v2/envelope/<id>` **638 ms after the 200** -> `status: "REJECTED"`.
8. `POST /api/v2/envelope/recipient/11/reject` (the other pending signer) -> **400** `{"message":"Document envelope_nfbbhctvneaaadxv must be pending to reject","data":{"code":"INVALID_REQUEST","httpStatus":400,"path":"envelope.recipient.rejectOnBehalfOf"}}`. Once the envelope has flipped, the other recipient is correctly blocked.
9. `GET /api/v2/envelope/<id>` -> `status: "REJECTED"`.

Timings in `poll-timeline.json`. Raw captures `step-1.*` to `step-9.*`.

## Run 2 (capture steps 10 to 14): the window bracketed

A second envelope (`envelope_mynwzrxyyiddmdfv`) with the same setup, then a tight poll every 25 ms starting the moment the reject returned:

| ms after the 200 from reject | envelope status |
|---|---|
| 12 | **PENDING** |
| 52 | REJECTED |

Recorded in `tight-poll.json`. Raw captures `step-10.*` to `step-14.*`.

## Comparison with the original transcript

The original run (v2.16.0) failed at its step 6 with `expected: json status equals "REJECTED" / actual: json status was "\"PENDING\""`, and the review noted the transcript only proved the flip had not happened within roughly 200 to 400 ms. The live run reproduces the same mismatch and measures the window: still PENDING at 12 ms and at 112 ms, REJECTED by 52 ms in one run and by 638 ms in the other. The variance is the local job poller, not the API.

## What this adds to the finding

- The stale read is reproducible on v2.17.0 and is what any integrator taking the documented "read it back immediately" path will see.
- The size of the window is small here (tens to hundreds of milliseconds on an idle single-user instance with `NEXT_PRIVATE_JOBS_PROVIDER=local`). A filing should therefore lead with the correctness half the research note recommends, not with the latency: during the window the envelope is still `PENDING`, and the guards in `sign-field-with-token` / `complete-document-with-token` key on exactly that, so the "other pending recipients can no longer act" promise is unenforced for its duration.
- One thing the live run confirms in the product's favour and worth stating: the recipient row is authoritative immediately (`signingStatus: REJECTED` and the reason are both present in the very first read), so an integration can read the rejection off `recipients[]` before the envelope agrees.
- Step 8 shows the second recipient IS blocked once the flip has landed, so the block itself works; only its timing is tied to the seal job.
