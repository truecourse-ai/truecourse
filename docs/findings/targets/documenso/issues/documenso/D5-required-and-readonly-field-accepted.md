---
finding: D5
target: documenso/documenso
route: public issue
title: POST /api/v2/envelope/field/create-many accepts a field that is both required and read-only
labels: bug (template default; the repo's actual label is "type: bug")
status: filed
filed_url: https://github.com/documenso/documenso/issues/3290
filed_at: 2026-08-20
format_note: Body matches documenso bug-report.yml labels exactly, including the bracketed environment labels.
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: still reproduces)
---
### Issue Description

The Field Types page states, in five separate Rules lists, that a field cannot be both required and read-only at the same time. The v2 create path never validates `fieldMeta` at all, so `POST /api/v2/envelope/field/create-many` accepts `{"required": true, "readOnly": true}` with a 200 and persists the field with the forbidden meta echoed back. The rules are enforced elsewhere in the codebase, on the editor's `setFieldsForDocument` path and again at signing time, so a configuration created over the API surfaces later as a signer-facing error the sender never saw.

#### Documentation

https://docs.documenso.com/docs/concepts/field-types, Text > Rules:

> * A field cannot be both required and read-only at the same time
> * A read-only field must have a default text value (it cannot be empty)

The same sentence appears in the Rules lists for Number, Radio, Checkbox and Dropdown, so the page states it as a product-wide invariant, and its Related section points at "Fields API - Programmatically add fields via the API".

#### Cause

The only validation the v2 create path runs is the block commented "Field validation and placeholder resolution": https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/packages/lib/server-only/field/create-envelope-fields.ts#L138-L245. It checks three things: that `envelopeItemId` belongs to the envelope, that `recipientId` exists, and that `canRecipientFieldsBeModified` allows new fields. It never inspects `fieldMeta`, and the values go straight to `field.createManyAndReturn` as `fieldMeta: field.fieldMeta`. The schema does not catch it either: `ZBaseFieldMeta` declares `required` and `readOnly` as two independent optional booleans with no cross-field refine, so the combination parses cleanly.

The validators for exactly these documented rules already exist in `packages/lib/advanced-fields-validation/`: `validate-text.ts` pushes "A field cannot be both read-only and required", with the same check in `validate-number.ts`, `validate-radio.ts`, `validate-checkbox.ts` and `validate-dropdown.ts`. They are called server-side from `packages/lib/server-only/field/set-fields-for-document.ts:136-195` and `set-fields-for-template.ts`. `createEnvelopeFields` simply does not call them.

The gap predates the envelope refactor: the pre-envelope `create-document-fields.ts` did not validate `fieldMeta` either, so #2025 (2025-10-14, "feat: add envelopes") carried an existing hole onto the v2 API rather than regressing working code. The doc page that promises the rules was added by #2460 (2026-02-27, "feat: docs v2") and has not changed since.

Still present at today's head, `75330166cc` (v2.17.0): https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/packages/lib/server-only/field/create-envelope-fields.ts#L138-L245. The create path, the shared validators and the doc page are all byte-identical to the tested v2.16.0.

Two scope facts: the same unvalidated service also backs the v1 `POST /document/field/create-many`, so this is not v2-only; and a fix should throw `AppError(AppErrorCode.INVALID_REQUEST)` so the API answers 400, rather than the bare `new Error(errors.join(', '))` the `setFields` path throws today, which surfaces as a 500 even where the rules are enforced.

#### Suggested labels

`type: bug`

#### Related

- #3152 (open) and #3122 (open): two community PRs inside `validateNumberField`, the shared validator this create path never calls. Neither causes nor fixes this, but both show the community treats `packages/lib/advanced-fields-validation` as the home of these rules.
- #3224 (open), "fix: don't create a field on top of an identical one": another change on this same create path, adding a duplicate-position guard and no `fieldMeta` validation. Worth considering together.
- #3170 (open), "Allow signature, initials and date fields to be optional": same `fieldMeta` surface, opposite direction. Not a duplicate.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.

### Steps to Reproduce

Build tested: v2.16.0 (tag `v2.16.0`, `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source: `npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`, against Postgres 17, with `NEXT_PRIVATE_JOBS_PROVIDER=local` and `NEXT_PUBLIC_UPLOAD_TRANSPORT=database`. Every call carries a team API token: `Authorization: <token>`. Ids below are from the recorded run.

1. Create an envelope from a template: `POST /api/v2/envelope/use`, `Content-Type: multipart/form-data; boundary=tcguard`, payload part `{"envelopeId":"<template envelope id>","externalId":"tcref-metabad-1435e8142f"}`. 200, `{"id":"envelope_vhullnaaebirmiar","recipients":[]}`.

2. Add a recipient:

   ```
   POST /api/v2/envelope/recipient/create-many
   {"envelopeId":"envelope_vhullnaaebirmiar","data":[{"email":"tcref-metabad-1435e8142f@documenso.test","name":"TCRef Meta Bad","role":"SIGNER"}]}
   ```

   200, recipient `id: 362`.

3. Create a TEXT field that is required and read-only at once:

   ```
   POST /api/v2/envelope/field/create-many
   {"envelopeId":"envelope_vhullnaaebirmiar","data":[{"type":"TEXT","recipientId":"362","page":1,"positionX":5,"positionY":10,"width":20,"height":5,"fieldMeta":{"type":"text","required":true,"readOnly":true,"text":"TCRef both"}}]}
   ```

   200, and the field is created.

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): still reproduces. All nine forbidden fieldMeta configurations (TEXT required+readOnly, readOnly TEXT with no text, readOnly NUMBER with no value, readOnly RADIO with no options, readOnly CHECKBOX with nothing checked, readOnly DROPDOWN with no default, a DROPDOWN default not among its options, and NUMBER defaults above and below their bounds) returned 200 and were persisted, where the original run had observed only the first.

### Expected Behavior

The call is refused with a 400 and no field row is created, the way the same rule is enforced on the editor's `setFieldsForDocument` path.

### Current Behavior

Step 3 returns HTTP 200 with the forbidden meta persisted and echoed back:

```json
{"data":[{"envelopeId":"envelope_vhullnaaebirmiar","envelopeItemId":"envelope_item_mmhrydibfzurfsru","type":"TEXT","id":332,"secondaryId":"cmstdmr340007y6yd9auawyz5","recipientId":362,"page":1,"positionX":"5","positionY":"10","width":"20","height":"5","customText":"","inserted":false,"fieldMeta":{"required":true,"readOnly":true,"type":"text","text":"TCRef both"},"documentId":368,"templateId":null}]}
```

The server log shows no warning and stderr is empty.

Scope of the evidence: only the required-plus-read-only TEXT case above was actually sent, because the recorded run stops at the first mismatch. Since no `fieldMeta` validation runs on this path at all, the other eight configurations the same page forbids are expected to be accepted too, but that is inference from the code, not observation. They are: a read-only text field with no default text; a read-only number field with no default value; a read-only radio field with no options; a read-only checkbox with no option checked; a read-only dropdown with no default value; a dropdown whose default value is not one of its options; a number field whose default is above its maximum; and a number field whose default is below its minimum.

Side observation from the same response: `positionX`, `positionY`, `width` and `height` come back as JSON strings although they are documented and accepted as numbers.

### Operating System [e.g., Windows 10]

n/a (API, self-hosted from source)

### Browser [e.g., Chrome, Firefox]

n/a (API)

### Version [e.g., 2.13.0]

2.16.0 (tested; tag `v2.16.0` = `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), re-checked in source against 2.17.0 (`75330166cc00b29c14399bc2e391e4b4d8080c00`), where the create path, the validators and the doc page are byte-identical.

### Please check the boxes that apply to this issue report.

- [x] I have searched the existing issues to make sure this is not a duplicate.
- [x] I have provided clear steps to reproduce the issue.
- [x] I have included the relevant environment information.
- [x] I understand that this is a voluntary contribution and that there is no guarantee of resolution.
