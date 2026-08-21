# F11.1 — a data request to a destroyed collection answers 500 where 404 belongs

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100, PostgreSQL 16 (project `tc-nocobase`, 127.0.0.1:15432) |
| scenario | `collections-are-listed-filtered-and-deleted-with-their-tables.api.1`, failing step 10 |
| **verdict** | **still reproduces** |

## Setup, as the super admin

```
POST /api/collections:create   {"name":"tcdestroy","title":"TC Destroy","template":"general"}  → 200
POST /api/collections/tcdestroy/fields:create {"name":"label","type":"string","interface":"input"} → 200
POST /api/tcdestroy:create     {"label":"row one"}
→ 200 {"data":{"id":1,"label":"row one"}}
GET  /api/tcdestroy:list
→ 200 {"data":[{"id":1,"label":"row one"}],"meta":{"count":1,"page":1,"pageSize":20,"totalPage":1}}

POST /api/collections:destroy?filterByTk=tcdestroy
→ 200 {"data":1}
```

The destroy itself is correct: the table is gone from PostgreSQL
(`select count(*) from information_schema.tables where table_name='tcdestroy'` → `0`).

## Probe

```
GET /api/tcdestroy:list
→ 500 {"errors":[{"message":"Cannot read properties of undefined (reading 'collection')"}]}
```

## Control — the same question about a name that never existed

```
GET /api/tcneverexisted:list
→ 404 Not Found
```

Same shape of question, two answers. 404 is not an opinion about what should happen here,
it is what this very api does for the only other way a collection can be absent.

## Mechanism (re-read at this SHA, unchanged)

- `packages/core/actions/src/utils.ts:26-39` — `getRepositoryFromParams(ctx)` ends at
  `return ctx.db.getRepository<Repository>(resourceName)`, which is `undefined` once the
  collection is gone. The resourcer route outlives the collection.
- `packages/core/actions/src/actions/list.ts:37` —
  `let { simplePaginate } = repository.collection?.options || {};`
  The optional chain guards `.options`, one level too deep: `repository` itself is the
  undefined one, so reading `.collection` off it throws
  `TypeError: Cannot read properties of undefined (reading 'collection')`.

## Raw captures

- `raw/F10-F11.json` — the shared transcript for F10, F11.1 and F11.2 (one admin session), with the postgres readings
- `raw/probe.stdout.txt`
