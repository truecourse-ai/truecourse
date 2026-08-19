# D3 live re-verification

**An ASSISTANT recipient is accepted on an envelope whose signing order is PARALLEL.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance: port 3347, database `tc_reverify_documenso`. Auth `Authorization: <owner api token>`, redacted in the captures.

## Verdict

**still reproduces**, both in the scenario's original form and in an explicit-PARALLEL variant the original run never tried.

## Steps

**Variant A — the original scenario: no signing order set at all**

Envelope `envelope_wkflbkwyccsbuznu` (`externalId: tcref-assistant-d35cadec2f`).

1. `POST /api/v2/envelope/use` -> **200**.
2. `GET /api/v2/envelope/envelope_wkflbkwyccsbuznu` -> **200**, `documentMeta.signingOrder` is **`PARALLEL`**. This is the product's own default, so the scenario's "no signing order set" envelope is a parallel envelope, which is the combination three doc pages say is not available.
3. `POST /api/v2/envelope/recipient/create-many`
   ```json
   {"envelopeId":"envelope_wkflbkwyccsbuznu","data":[{"email":"tcref-asst-d35cadec2f@documenso.test","name":"TCRef Assistant","role":"ASSISTANT"}]}
   ```
   -> **200** (expected 400). Response `data[0]`:
   ```json
   {"envelopeId":"envelope_wkflbkwyccsbuznu","role":"ASSISTANT","readStatus":"NOT_OPENED","signingStatus":"NOT_SIGNED","sendStatus":"NOT_SENT",
    "id":8,"email":"tcref-asst-d35cadec2f@documenso.test","name":"TCRef Assistant","token":"Cd10EhXfCDmlPIT4qPz4A","signingOrder":null,"rejectionReason":null}
   ```

**Variant B — signing order set to PARALLEL explicitly**

Envelope `envelope_fteuhazrouxlatwn`.

4. `POST /api/v2/envelope/use` -> **200**.
5. `POST /api/v2/envelope/update` `{envelopeId, meta:{signingOrder:"PARALLEL"}}` -> **200**.
6. `POST /api/v2/envelope/recipient/create-many` with `role: "ASSISTANT"` -> **200** (expected 400), recipient id `9`, token `1vSbCfk6CVHuk3FZKT3MB`, `signingOrder: null`.
7. `GET /api/v2/envelope/envelope_fteuhazrouxlatwn` -> **200**; the envelope reads `documentMeta.signingOrder: "PARALLEL"` with `recipients: [{"id":9,"role":"ASSISTANT","signingOrder":null}]`. The illegal state is persisted and readable.

Raw captures: `step-1.request.json` ... `step-7.response.json`.

## Comparison with the original transcript

The original run (v2.16.0) failed at its step 2 with `expected: status 400 / actual: status 200`, creating ASSISTANT recipient id 349 with `signingOrder: null`. The live run on v2.17.0 reproduces that exactly, and step 7 adds the read-back that the original never took: the envelope really is `PARALLEL` and really does carry an ASSISTANT.

## What this adds to the finding

- The `signingOrder: null` on the created ASSISTANT is confirmed on the wire in both variants. That is the value the review flagged as the reason `getRecipientsForAssistant` and `getFieldsForToken` (`signingOrder: { gte: assistant.signingOrder ?? 0 }`) return nothing for it: `NULL >= 0` is NULL, not true, in SQL. So the assistant is created into a state where its own view of the document is empty.
- Variant B rules out the reading that the refusal only applies when the caller explicitly asks for PARALLEL. It does not: the endpoint has no refusal at all.
- The framing the research note asks for is confirmed by the live run: this is "no refusal exists", not "the wrong status code is returned".
