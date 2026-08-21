# F10 — the identifier rule the manual states is enforced only in the browser

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100, PostgreSQL 16 (project `tc-nocobase`, 127.0.0.1:15432) |
| browser | `playwright-core` 1.62.1 from `packages/guard-runner`, headless Chromium **rev 1194** (see note at the end) |
| scenarios | `a-collection-name-is-chosen-once-and-then-fixed.api.1` step 2, `a-field-identifier-is-validated-once-and-then-fixed.api.1` step 7 |
| **verdict** | **still reproduces**, both halves |

## Doc, re-read at this SHA

`docs/docs/en/data-sources/data-source-main/general-collection.md:35`, the Collection name row:

> The internal identifier used by APIs, relation fields, permissions, and workflows. It is
> generated automatically but can be changed before creation. It supports letters, numbers,
> and underscores and must start with a letter.

`docs/docs/en/data-sources/data-modeling/collection-fields/system-info/created-by.md:34`, the Field name row:

> The field identifier used internally by APIs, relation fields, permissions, and workflows.
> It usually cannot be changed after creation. It supports only letters, numbers, and
> underscores, and must begin with a letter.

## Probe — the api takes both

```
POST /api/collections:create {"name":"9tcbad","title":"TC Bad Name","template":"general"}
→ 200 {"data":{"inherit":false,"hidden":false,"key":"16j176ucalm","name":"9tcbad",
        "title":"TC Bad Name","description":null,"template":"general","createdAt":false,
        "createdBy":false,"updatedAt":false,"updatedBy":false,"filterTargetKey":"id",
        "unavailableActions":[]}}

POST /api/collections/9tcbad/fields:create {"name":"9bad","type":"string","interface":"input"}
→ 200 {"data":{"key":"xuguq66zcwl","name":"9bad","type":"string","interface":"input",
        "collectionName":"9tcbad","description":null,"parentKey":null,"reverseKey":null}}
```

Both are materialized in PostgreSQL:

```
information_schema.tables   → 9tcbad
information_schema.columns  → id (bigint), 9bad (character varying)
```

## Control — the browser refuses the same string

The live Create-collection drawer (`/admin/settings/data-source-manager/main/collections?type=main`
→ `Create collection` → `General collection`) carries the product's own statement of the
rule, read off the DOM verbatim:

> Randomly generated and can be modified. Support letters, numbers and underscores, must
> start with a letter.

The field arrives pre-filled with a generated value (`t_uet0iceqkoz` on this run). Typing
`9tcbad` into it and blurring produces, from the form itself:

```
validation errors shown by the form: ["This field is invalid"]
Submit buttons reachable by role in the drawer: 0
```

So the rule the manual states is enforced, in the browser and only there. The same string
posted at the api creates a real table.

Source of that rule:
`packages/core/client/src/collection-manager/templates/properties/index.ts:28` carries
`'x-validator': 'uid'` on the Collection name field, with the description quoted above one
line below.

## Raw captures

- `raw/F10-F11.json` — the api transcript with the postgres readings
- `raw/web.json` → key `F10_browser` — the drawer text, the typed value, the validation errors
- `raw/f10-name-invalid.png` — the drawer with the invalid name
- `raw/probe.stdout.txt`, `raw/web.stdout.txt`

## Browser note

`chrome-headless-shell` for the revision this `playwright-core` wants (1234) is not on
this host, and neither is Chromium 1234. The full Chromium build of revision **1194** was
launched explicitly via `executablePath`. Every locator used here is version-stable
(`getByRole`, `getByTitle`, plain CSS), and the DOM facts below are read off the page
rather than inferred.
