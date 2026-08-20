---
finding: D3
target: documenso/documenso
route: public issue
title: POST /api/v2/envelope/recipient/create-many accepts an ASSISTANT recipient on a parallel-signing envelope
labels: bug (template default; the repo's actual label is "type: bug")
status: filed
filed_url: https://github.com/documenso/documenso/issues/3291
filed_at: 2026-08-20
format_note: Body matches documenso bug-report.yml labels exactly, including the bracketed environment labels.
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: still reproduces)
---
### Issue Description

Two published pages state that the Assistant role is only available when sequential signing is enabled, and one of them lists "Be used in parallel signing mode" under what an assistant cannot do. The v2 API does not enforce it. On an envelope whose `documentMeta.signingOrder` is `PARALLEL`, `POST /api/v2/envelope/recipient/create-many` with `role: ASSISTANT` returns 200 and persists the recipient. There is no refusal of any kind.

The result is not only a contract violation. With `signingOrder` PARALLEL, `send-document.ts` notifies every recipient at once, so signers can sign before the assistant has pre-filled anything, which is the guarantee the restriction exists to protect. And the assistant's own view is broken: `getRecipientsForAssistant` and `getFieldsForToken` filter with `signingOrder: { gte: assistant.signingOrder ?? 0 }`, which is NULL-false in SQL for the null `signingOrder` an API-created parallel recipient carries, so the assistant sees an empty recipient list and none of the fields they are supposed to pre-fill.

#### Documentation

https://docs.documenso.com/docs/concepts/recipient-roles, Assistant tab:

> Assistants can prepare the document by pre-filling fields on behalf of other signers. This role is only available when sequential signing is enabled.

> **What they cannot do:**
>
> * Sign on behalf of other recipients
> * Submit the document as complete
> * Be used in parallel signing mode

> The Assistant role requires sequential signing to be enabled. You cannot use this role when recipients sign in parallel.

https://docs.documenso.com/docs/users/documents/add-recipients:

> The Assistant role is only available when sequential signing is enabled.

> Sequential signing is required to use the Assistant role. Assistants must act before the signers whose fields they pre-fill.

`add-recipients` frames the rule as an editor toggle, but `recipient-roles` states it as a property of the role itself, so it binds the API too.

#### Cause

`createEnvelopeRecipients` runs exactly one per-recipient role assertion: https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/packages/lib/server-only/recipient/create-envelope-recipients.ts#L62-L97. The loop calls `assertCompatibleRecipientRole({ signatureLevel: envelope.signatureLevel, role: recipient.role })`, which keys on signature level alone and only rejects ASSISTANT on AES/QES (TSP) envelopes, returning early for SES, the default. Nothing on the path reads `envelope.documentMeta.signingOrder`, and no PARALLEL or SEQUENTIAL comparison exists anywhere in the file. The request schema accepts `z.nativeEnum(RecipientRole)` with no refinement and the route adds nothing.

The rule lives only in the two editor forms: `packages/ui/primitives/document-flow/add-signers.tsx` and `apps/remix/app/components/general/envelope-editor/envelope-editor-recipient-form.tsx` both intercept a role change to ASSISTANT while signingOrder is PARALLEL, flip the form to SEQUENTIAL and toast "You cannot add assistants when signing order is disabled". Grepping `ASSISTANT` across `packages/lib/server-only` and `packages/trpc/server` finds no signing-order check at all. The role and its client-side-only enforcement arrived together in #1588 (2025-02-01, "feat: assistant role"); the v2 route that exposes the gap is #2105 (2025-11-07, "feat: add envelopes api").

Still present at today's head, `75330166cc` (v2.17.0): https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/packages/lib/server-only/recipient/create-envelope-recipients.ts#L62-L97. The file and both doc pages are byte-identical to the tested v2.16.0.

The codebase already has the shape of the fix: `packages/lib/server-only/signature-level/` holds `assert-compatible-recipient-role.ts` and `assert-compatible-signing-order.ts`, two asserts called from this same service. A complete fix has to cover `update-envelope-recipients` and the envelope-meta path as well, since flipping an envelope back to PARALLEL while an ASSISTANT recipient exists reaches the same illegal state from the other side.

#### Suggested labels

`type: bug`

#### Related

- #2973, "Assistant (Form Filler) Must Always Act Before Signers Without Requiring Workflow Ordering" (open): argues the restriction should be dropped and the assistant made a role that always acts first. It does not report that the API accepts the combination. There are two acceptable resolutions to this issue and they point in opposite directions: enforce the documented rule server-side, or change the docs and the workflow the way #2973 asks. Either settles it; the current state, where the docs forbid it and the API allows it, does not.
- #2995 (closed unmerged, 2026-06-22): the community PR for #2973, which would have removed the UI restriction and reordered notification and turn logic. Because it never landed, the docs still forbid the combination while the API still allows it.
- #1588 (merged): origin of the role and of the UI-only enforcement.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.

### Steps to Reproduce

Build tested: v2.16.0 (tag `v2.16.0`, `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source: `npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`, against Postgres 17, with `NEXT_PRIVATE_JOBS_PROVIDER=local` and `NEXT_PUBLIC_UPLOAD_TRANSPORT=database`. Every call carries a team API token: `Authorization: <token>`. Ids below are from the recorded run.

1. Create an envelope and leave its signing order at the default (`documentMeta.signingOrder` is `PARALLEL` for an envelope created this way):

   `POST /api/v2/envelope/use`, `Content-Type: multipart/form-data; boundary=tcguard`, payload part `{"envelopeId":"<template envelope id>","externalId":"tcref-assistant-cb1cebb0ee"}`
   200, `{"id":"envelope_uanynwhkkxelvdtm","recipients":[]}`

   `GET /api/v2/envelope/envelope_uanynwhkkxelvdtm` confirms `"documentMeta":{"signingOrder":"PARALLEL", ...}`.

2. Add an assistant:

   ```
   POST /api/v2/envelope/recipient/create-many
   {"envelopeId":"envelope_uanynwhkkxelvdtm","data":[{"email":"tcref-asst-cb1cebb0ee@documenso.test","name":"TCRef Assistant","role":"ASSISTANT"}]}
   ```

   200, and the recipient is persisted.

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): still reproduces. ASSISTANT was accepted with 200 both on the default envelope, whose documentMeta.signingOrder reads PARALLEL, and on one set to PARALLEL explicitly, and the created recipient carries signingOrder: null, the value that makes the assistant's own document view come back empty.

### Expected Behavior

The call is refused and no recipient is created, because the envelope signs in parallel. No doc page publishes a status code for this refusal; `AppErrorCode.INVALID_BODY` maps to 400 and is what the sibling `assertCompatibleRecipientRole` already throws for the AES/QES case. The point of this report is that there is no refusal at all, not that the status code is wrong.

### Current Behavior

Step 2 returns HTTP 200 with the assistant created:

```json
{"data":[{"envelopeId":"envelope_uanynwhkkxelvdtm","role":"ASSISTANT","readStatus":"NOT_OPENED","signingStatus":"NOT_SIGNED","sendStatus":"NOT_SENT","id":349,"email":"tcref-asst-cb1cebb0ee@documenso.test","name":"TCRef Assistant","token":"<token>","documentDeletedAt":null,"expired":null,"expiresAt":null,"expirationNotifiedAt":null,"signedAt":null,"authOptions":{"accessAuth":[],"actionAuth":[]},"signingOrder":null,"rejectionReason":null}]}
```

The server log records `envelope.recipient.createMany` running normally, with no warning; stderr is empty.

Provenance of the PARALLEL claim: this particular recorded scenario did not read the envelope back between step 1 and step 2, so the `PARALLEL` signing order comes from sibling runs in the same session, where every envelope minted from a template this way carries `documentMeta.signingOrder: "PARALLEL"` (30 of the 31 signing-order readings across the session are PARALLEL, the one exception being an envelope explicitly set to SEQUENTIAL). The GET in step 1 above makes that check part of the reproduction.

Note `"signingOrder": null` on the created row: that is the value the assistant's own queries then filter against with `gte`, which is why the assistant's recipient and field lists come back empty.

### Operating System [e.g., Windows 10]

n/a (API, self-hosted from source)

### Browser [e.g., Chrome, Firefox]

n/a (API)

### Version [e.g., 2.13.0]

2.16.0 (tested; tag `v2.16.0` = `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), re-checked in source against 2.17.0 (`75330166cc00b29c14399bc2e391e4b4d8080c00`), where the culprit file and both doc pages are byte-identical.

### Please check the boxes that apply to this issue report.

- [x] I have searched the existing issues to make sure this is not a duplicate.
- [x] I have provided clear steps to reproduce the issue.
- [x] I have included the relevant environment information.
- [x] I understand that this is a voluntary contribution and that there is no guarantee of resolution.
