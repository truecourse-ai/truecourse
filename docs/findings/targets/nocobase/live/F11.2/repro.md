# F11.2 — `fields:create` with a field interface and no data type answers 500

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100, PostgreSQL 16 (project `tc-nocobase`, 127.0.0.1:15432) |
| scenario | `a-field-interface-carries-a-default-data-type-and-allows-others.api.1`, failing step 3 |
| **verdict** | **still reproduces** |

## Probe

```
POST /api/collections/9tcbad/fields:create
  {"name":"amount","interface":"number"}

→ 500 {"errors":[{"message":"unsupported field type null"}]}
```

## Control — the identical request with an explicit type

```
POST /api/collections/9tcbad/fields:create
  {"name":"amount2","type":"double","interface":"number"}

→ 200 {"data":{"key":"53xebcq5fbl","name":"amount2","type":"double","interface":"number",
        "collectionName":"9tcbad","description":null,"parentKey":null,"reverseKey":null}}
```

The only difference between the two requests is the `type` the caller had to supply by
hand, and `double` is exactly the default the manual promises.

## Doc

`docs/docs/en/data-sources/data-modeling/collection-fields/index.md:64`, re-read at this SHA:

> Each Field interface has a default data type. For example, a field with the Number
> interface uses `double` by default, but it can also use `float`, `decimal`, and other
> data types.

## Mechanism (re-read at this SHA, unchanged)

`packages/core/database/src/database.ts:779`:

```ts
const Field = this.fieldTypes.get(type);

if (!Field) {
  throw Error(`unsupported field type ${type}`);
}
```

A bare `Error`, so the koa error handler renders it 500 rather than 400.

## Raw captures

- `raw/F10-F11.json` — the shared transcript for F10, F11.1 and F11.2
- `raw/probe.stdout.txt`
