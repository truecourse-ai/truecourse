# F12 — a `view:own` role makes every union read against a collection with no `createdById` answer an opaque 403

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100, PostgreSQL 16 (project `tc-nocobase`, 127.0.0.1:15432) |
| scenario | `role-union-merges-the-rows-either-role-may-see.api.1`, failing step 7 |
| **verdict** | **still reproduces**, with all three controls |

## Preconditions, read off the instance

```
select "roleMode" from "systemSettings"            → allow-use-union
select strategy from roles where name='member'     → {"actions":["view:own"]}
tcunionmixed columns                               → id, name, age, sex        (no createdById)
```

`tcunionmixed` was created with `collections:create`, which presets nothing, so it has no
`createdById`. The shipped `own` scope is
`{"createdById":"{{ ctx.state.currentUser.id }}"}` (`raw/scopes.txt`, row `own`).

Every read below re-signs in as `tcunion` first, so no stale role cache is involved.

## Probe — the same request, two role sets

```
roles = tcuniona+tcunionb                (two)
GET /api/tcunionmixed:list?sort=id   X-Role: __union__
→ 200 {"data":[{"name":"Jack","sex":"Man","id":1,"age":23},
               {"name":"Lily","sex":"Woman","id":2,"age":29},
               {"name":"Jade","sex":"Woman","id":3,"age":27},
               {"name":"James","sex":"Man","id":4,"age":31}],"meta":{"count":4,...}}

POST /api/roles/member/users:add [2]     # member's strategy is {"actions":["view:own"]}

roles = member+tcuniona+tcunionb         (three)
GET /api/tcunionmixed:list?sort=id   X-Role: __union__
→ 403 {"errors":[{"message":"No permissions"}]}
```

## Control 1 — removing the role restores the answer

```
POST /api/roles/member/users:remove [2]
roles = tcuniona+tcunionb
GET /api/tcunionmixed:list?sort=id   X-Role: __union__
→ 200 (the same four rows)
```

## Control 2 — the individual roles are unaffected

```
roles = member+tcuniona+tcunionb
GET /api/tcunionmixed:list?sort=id   X-Role: tcuniona
→ 200 {"data":[{"age":23,"name":"Jack","id":1},{"age":29,"name":"Lily","id":2},{"age":27,"name":"Jade","id":3}],"meta":{"count":3,...}}
```

Only the merged action carries the poisoned filter.

## Control 3 — the mechanism, proved by removing its precondition

With all three roles still held, giving `tcunionmixed` a `createdById` column and
re-issuing the identical request:

```
POST /api/collections/tcunionmixed/fields:create
  {"name":"createdBy","type":"belongsTo","interface":"createdBy","target":"users",
   "foreignKey":"createdById","targetKey":"id", ...}
→ 200

columns now: id, name, age, sex, createdById

GET /api/tcunionmixed:list?sort=id   X-Role: __union__
→ 200 {"data":[{"id":1,"name":"Jack","age":23,"sex":"Man","createdById":null},
               {"id":2,"name":"Lily","age":29,"sex":"Woman","createdById":null},
               {"id":3,"name":"Jade","age":27,"sex":"Woman","createdById":null},
               {"id":4,"name":"James","age":31,"sex":"Man","createdById":null}],"meta":{"count":4,...}}
```

403 to 200 on the strength of one column, with the role set unchanged.

## Mechanism (re-read at this SHA, unchanged)

- `packages/core/acl/src/acl.ts:645-656` — `checkFilterParams(collection, filter)` throws
  `new NoPermissionError('createdById field not found')` when the filter mentions
  `createdById` and the collection has no such field.
- `packages/core/acl/src/acl.ts:530-537` — the reason is then discarded:

  ```ts
  } catch (e) {
    if (e instanceof NoPermissionError) {
      ctx.throw(403, 'No permissions');
      return;
    }
    throw e;
  }
  ```

  Every `NoPermissionError` becomes the same opaque string, which is why the 403 above
  names nothing about `createdById`.

## Raw captures

- `raw/F12.json` — full transcript with the role set and the status of every step
- `raw/scopes.txt` — the `dataSourcesRolesResourcesScopes` rows, including the shipped `own` scope
- `raw/probe.stdout.txt`
