---
finding: D2a
target: documenso/documenso
route: comment on existing PR #3136
title: Confirmation of the coordinate no-op on v2.16.0 and v2.17.0, plus the fieldMeta half this PR does not cover
labels: none (PR comment)
status: draft
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: still reproduces)
---

# Comment to post on https://github.com/documenso/documenso/pull/3136

Independent confirmation of the bug this PR fixes, and one thing the current diff does not cover.

Tested against v2.16.0 (tag `v2.16.0`, `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source (`npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`) against Postgres 17. A TEXT field was created on a draft envelope at `positionX: 10`, `positionY: 20`, then moved with the schema-valid v2 body:

```
POST /api/v2/envelope/field/update-many
{"envelopeId":"envelope_yroalbrelnoaxrmm","data":[{"id":"300","type":"TEXT","positionY":60}]}
```

The response was HTTP 200 with the field unmoved:

```json
{"data":[{"envelopeId":"envelope_yroalbrelnoaxrmm","envelopeItemId":"envelope_item_iuruhhafmskdumud","type":"TEXT","id":300,"secondaryId":"cmstdmf0l0007y6r79fbzxeee","recipientId":334,"page":1,"positionX":"10","positionY":"20","width":"20","height":"5","customText":"","inserted":false,"fieldMeta":{"label":"","placeholder":"","required":false,"readOnly":false,"fontSize":12,"type":"text","text":"","textAlign":"left"},"documentId":343,"templateId":null}]}
```

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): still reproduces. An update-many with {id, type, positionY: 60} returned 200 with positionY "20" and the stored field unchanged, and a control call sending page, positionX, positionY, width and height together also moved nothing.

That matches the diagnosis in this PR exactly: the route validates `page` / `positionX` / `positionY` and the service reads `updateData.pageNumber` / `pageX` / `pageY`, so Prisma receives `undefined` and skips the columns. One detail worth adding: `width` and `height` share a name across the two schemas, so today a request that moves and resizes in one call applies the resize and silently drops the move, which is a partial write rather than a clean no-op. The mapping in this PR closes all of that. The culprit files are byte-identical between v2.16.0 and v2.17.0 (`75330166cc`), so the no-op now ships in two consecutive releases, and since this branch is rebased onto `main` it can land on its own.

The part this PR does not cover: the same call also destroys the field's configuration, and the diff here does not stop it. Before the update the stored meta was `{"label":"Job Title","placeholder":"Enter your job title","required":true,"type":"text","characterLimit":40,"textAlign":"left"}`; after it, as shown above, it is byte-for-byte `FIELD_TEXT_META_DEFAULT_VALUES`. The cause is `ZEnvelopeFieldAndMetaSchema` (`packages/lib/types/field-meta.ts:403-448`), where every fieldMeta-bearing member is `Z<Type>FieldMeta.optional().default(FIELD_<TYPE>_META_DEFAULT_VALUES)`; `type` is the union discriminator and is mandatory on an update, so an omitted `fieldMeta` is not `undefined`, zod materialises the full default object and `update-envelope-fields.ts:136` writes it unconditionally. The new mapping object introduced in this PR still passes `fieldMeta: field.fieldMeta`, which is that defaulted value, so with this PR merged a move would work and would still wipe the field's label, placeholder, required flag, character limit and, for RADIO, CHECKBOX and DROPDOWN, the entire option list. That is worth fixing in the same change, or at least worth knowing before merge, because merging as-is removes the loud symptom and leaves the quiet one. The fix shape is a schema for the update route whose `fieldMeta` is optional with no default, so an omitted `fieldMeta` leaves the column untouched while create keeps its defaults. The fieldMeta half is reported separately as its own bug report.

Found by TrueCourse running the published API docs against a live instance; the full transcript (requests, responses, server log) is available on request.
