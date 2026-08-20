---
finding: D2b
target: documenso/documenso
route: public issue
title: POST /api/v2/envelope/field/update-many resets a field's fieldMeta to type defaults when fieldMeta is omitted
labels: bug (template default; the repo's actual label is "type: bug")
status: filed
filed_url: https://github.com/documenso/documenso/issues/3286
filed_at: 2026-08-20
format_note: Body matches documenso bug-report.yml labels exactly (### Issue Description / Steps to Reproduce / Expected Behavior / Current Behavior / Operating System [e.g., Windows 10] / Browser [e.g., Chrome, Firefox] / Version [e.g., 2.13.0] + the checkbox block). No enforcing bot on this repo, but matching keeps a triager oriented.
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: still reproduces)
---
### Issue Description

The Fields API documents `update-many` as a partial update: change one property of one field in a single request. In practice, any `update-many` call that does not resend the complete `fieldMeta` overwrites the stored configuration with the type's default metadata, behind a 200 that echoes the wiped state as though it were the update result. A TEXT field loses its label, placeholder, required flag and character limit; a RADIO field's option list becomes a single blank option, a CHECKBOX's becomes one blank unchecked option, a DROPDOWN's becomes a single "Option 1". There is no way to avoid it from the client side: `type` is the schema's union discriminator and is therefore mandatory on an update, so the default is always materialised. The documented update example, `{ id, type, pageY }`, is exactly the call that triggers it.

#### Documentation

https://docs.documenso.com/docs/developers/api/fields, "Update Fields":

> Update Fields [#update-fields]
>
> Update one or more fields in a single request.
>
> `POST /envelope/field/update-many`

and the response the page shows for that partial update:

```json
{
  "fields": [
    { "id": 101, "type": "SIGNATURE", "positionY": 85 },
    { "id": 102, "type": "DATE", "positionY": 85 }
  ]
}
```

Nothing on the page says a partial update discards the rest of the field's configuration.

#### Cause

`ZEnvelopeFieldAndMetaSchema` gives every fieldMeta-bearing member a create-time default: https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/packages/lib/types/field-meta.ts#L403-L448. All ten members read `fieldMeta: Z<Type>FieldMeta.optional().default(FIELD_<TYPE>_META_DEFAULT_VALUES)` (SIGNATURE, INITIALS, NAME, EMAIL, DATE, TEXT, NUMBER, RADIO, CHECKBOX, DROPDOWN). The update route consumes that schema (`packages/trpc/server/envelope-router/envelope-fields/update-envelope-fields.types.ts:18`), so an omitted `fieldMeta` arrives at the service as the full default object rather than as `undefined`, and the service writes it unconditionally inside `tx.field.update`: https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/packages/lib/server-only/field/update-envelope-fields.ts#L136.

The defaults were introduced for create by #2181 (2025-11-12, "fix: add default values for envelope field meta"), which switched the update route's types from `ZFieldAndMetaSchema` to `ZEnvelopeFieldAndMetaSchema`; they are correct for create and wrong for update. The deprecated `/document/field/update-many` path is unaffected: its `ZUpdateFieldSchema` uses the plain `ZFieldAndMetaSchema` with no defaults.

Still present at today's head, `75330166cc` (v2.17.0): both `field-meta.ts` and `update-envelope-fields.ts` are byte-identical to the tested v2.16.0.

Fix shape: give the update route a schema whose `fieldMeta` is optional with no default, so an omitted `fieldMeta` leaves the column untouched, and leave create's defaults alone.

#### Suggested labels

`type: bug`

#### Related

- PR #3136 fixes the sibling defect on the same endpoint (the route validates `page` / `positionX` / `positionY` while the service reads `pageNumber` / `pageX` / `pageY`, so a move is a silent no-op). It covers the coordinate half only. Its current diff still forwards `fieldMeta: field.fieldMeta`, the zod-defaulted value, so with #3136 merged a move would work and the field's configuration would still be wiped. Merging it makes the endpoint look fixed while this defect stays.
- The audit log written by `diffFieldChanges` records the fieldMeta reset, so the loss is visible in the audit trail even though nothing surfaces it to the caller.

Found by TrueCourse running the published API docs against a live instance; the full transcript (requests, responses, server log) is available on request.

### Steps to Reproduce

Build tested: v2.16.0 (tag `v2.16.0`, `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source: `npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`, against Postgres 17, with `NEXT_PRIVATE_JOBS_PROVIDER=local` and `NEXT_PUBLIC_UPLOAD_TRANSPORT=database`. Every call carries a team API token: `Authorization: <token>`. Ids below are from the recorded run.

1. Create an envelope from a template: `POST /api/v2/envelope/use`, `Content-Type: multipart/form-data; boundary=tcguard`, payload part `{"envelopeId":"<template envelope id>","externalId":"tcref-fieldmove-4850ccfd5b"}`. 200, `{"id":"envelope_yroalbrelnoaxrmm","recipients":[]}`.

2. Add a recipient:

   ```
   POST /api/v2/envelope/recipient/create-many
   {"envelopeId":"envelope_yroalbrelnoaxrmm","data":[{"email":"tcref-4850ccfd5b@documenso.test","name":"TCRef Signer","role":"SIGNER"}]}
   ```

   200, recipient `id: 334`.

3. Create a configured TEXT field:

   ```
   POST /api/v2/envelope/field/create-many
   {"envelopeId":"envelope_yroalbrelnoaxrmm","data":[{"type":"TEXT","recipientId":"334","page":1,"positionX":10,"positionY":20,"width":20,"height":5,"fieldMeta":{"type":"text","label":"Job Title","placeholder":"Enter your job title","required":true,"characterLimit":40,"textAlign":"left"}}]}
   ```

   200, field `id: 300`, and the response echoes the meta back: `"fieldMeta":{"label":"Job Title","placeholder":"Enter your job title","required":true,"type":"text","characterLimit":40,"textAlign":"left"}`.

4. Update one property, sending no `fieldMeta`:

   ```
   POST /api/v2/envelope/field/update-many
   {"envelopeId":"envelope_yroalbrelnoaxrmm","data":[{"id":"300","type":"TEXT","positionY":60}]}
   ```

   200. The stored `fieldMeta` is now the TEXT defaults.

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): still reproduces, unchanged. The same 200 replaced {label:'Job Title', placeholder:'Enter your job title', required:true, characterLimit:40, textAlign:'left'} with the text-type defaults.

### Expected Behavior

An `update-many` call that does not carry `fieldMeta` leaves the field's stored `fieldMeta` untouched. After step 4 the field still reads `{"label":"Job Title","placeholder":"Enter your job title","required":true,"type":"text","characterLimit":40,"textAlign":"left"}`.

### Current Behavior

Step 4 returns HTTP 200 and the stored configuration is gone:

```json
{"data":[{"envelopeId":"envelope_yroalbrelnoaxrmm","envelopeItemId":"envelope_item_iuruhhafmskdumud","type":"TEXT","id":300,"secondaryId":"cmstdmf0l0007y6r79fbzxeee","recipientId":334,"page":1,"positionX":"10","positionY":"20","width":"20","height":"5","customText":"","inserted":false,"fieldMeta":{"label":"","placeholder":"","required":false,"readOnly":false,"fontSize":12,"type":"text","text":"","textAlign":"left"},"documentId":343,"templateId":null}]}
```

That `fieldMeta` is byte-for-byte `FIELD_TEXT_META_DEFAULT_VALUES` (`packages/lib/types/field-meta.ts:302-312`). The response is built from the row after `prisma.field.update`, so it is what is persisted. The server log shows the `envelope.field.updateMany` call completing normally; stderr is empty.

The blast radius is all ten fieldMeta-bearing types. RADIO drops to `values: [{id: 1, checked: false, value: ''}]`, CHECKBOX to one blank unchecked option, DROPDOWN to `values: [{value: 'Option 1'}]` with an empty default, TEXT and NUMBER lose label, placeholder, default text or value, character limit and min/max. Every SDK generated from the v2 OpenAPI document inherits it.

The same response also shows the coordinate no-op that PR #3136 addresses: `positionY` is still `"20"` after a request that asked for 60.

### Operating System [e.g., Windows 10]

n/a (API, self-hosted from source)

### Browser [e.g., Chrome, Firefox]

n/a (API)

### Version [e.g., 2.13.0]

2.16.0 (tested; tag `v2.16.0` = `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), re-checked in source against 2.17.0 (`75330166cc00b29c14399bc2e391e4b4d8080c00`), where the culprit files are byte-identical.

### Please check the boxes that apply to this issue report.

- [x] I have searched the existing issues to make sure this is not a duplicate.
- [x] I have provided clear steps to reproduce the issue.
- [x] I have included the relevant environment information.
- [x] I understand that this is a voluntary contribution and that there is no guarantee of resolution.
