# UNION-REWRITE — `X-Role: __union__` is silently rewritten under the default role mode

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| built by | `yarn install --frozen-lockfile` then `yarn build`, node v20.19.5 |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100, PostgreSQL 16 (project `tc-nocobase`, 127.0.0.1:15432), seeded by `reference/seed/guard-seed.mjs` |
| scenario | `roles-are-used-one-at-a-time-under-independent-roles.api.1`, failing step 6 |
| **verdict** | **still reproduces** |

## Fixture (the corpus seed's own `union-fixture`)

- collection `tcunionmixed`: `1|Jack|23|Man`, `2|Lily|29|Woman`, `3|Jade|27|Woman`, `4|James|31|Man`
- role `tcuniona`: `view` scoped `{"$and":[{"age":{"$lt":30}}]}`, fields `["name","age"]`
- role `tcunionb`: `view` scoped `{"$and":[{"name":{"$includes":"Ja"}}]}`, fields `["name","sex"]`
- user `tcunion`, holding exactly those two roles (`rolesUsers` → `tcuniona+tcunionb`)
- `select "roleMode" from "systemSettings"` → **`default`**

## Probe

```
GET /api/tcunionmixed:list?sort=id   X-Role: tcuniona
→ 200 {"data":[{"age":23,"name":"Jack","id":1},{"age":29,"name":"Lily","id":2},{"age":27,"name":"Jade","id":3}],"meta":{"count":3,"page":1,"pageSize":20,"totalPage":1}}

GET /api/tcunionmixed:list?sort=id   X-Role: __union__
→ 200 {"data":[{"age":23,"name":"Jack","id":1},{"age":29,"name":"Lily","id":2},{"age":27,"name":"Jade","id":3}],"meta":{"count":3,"page":1,"pageSize":20,"totalPage":1}}
```

**Byte-identical** (`asA.text === asUnion.text` → `true`). The caller asked to act as the
union and acted as `tcuniona`.

The server says so itself. `roles:check` reports which role the request resolved to:

```
GET /api/roles:check   X-Role: __union__   → data.role = "tcuniona"
GET /api/roles:check   X-Role: tcuniona    → data.role = "tcuniona"
```

## Control 1 — any other unheld role name is refused

```
GET /api/tcunionmixed:list?sort=id   X-Role: admin
→ 401 {"errors":[{"message":"The role does not belong to the user","code":"ROLE_NOT_FOUND_FOR_USER"}]}

GET /api/tcunionmixed:list?sort=id   X-Role: tcnosuchrole
→ 401 {"errors":[{"message":"The role does not belong to the user","code":"ROLE_NOT_FOUND_FOR_USER"}]}
```

`__union__` is the only unheld name that does not get this treatment.

## Control 2 — flip the mode, same header, genuinely different answer

```
POST /api/roles:setSystemRoleMode {"roleMode":"allow-use-union"}   → 200
select "roleMode" from "systemSettings"  → allow-use-union

GET /api/tcunionmixed:list?sort=id   X-Role: __union__
→ 200 {"data":[{"name":"Jack","sex":"Man","id":1,"age":23},
               {"name":"Lily","sex":"Woman","id":2,"age":29},
               {"name":"Jade","sex":"Woman","id":3,"age":27},
               {"name":"James","sex":"Man","id":4,"age":31}],"meta":{"count":4,...}}
```

Four rows, `age` **and** `sex`. The default-mode answer had three rows and no `sex`, so it
was `tcuniona`'s answer and not a union. A 401 would be a refusal; a 200 under a role the
caller never named is a substitution.

## Mechanism (re-read at this SHA, unchanged)

`packages/plugins/@nocobase/plugin-acl/src/server/middlewares/setCurrentRole.ts:55-58`:

```ts
if ([currentRole, ctx.state.currentRole].includes(UNION_ROLE_KEY) && roleMode === SystemRoleMode.default) {
  currentRole = userRoles[0].name;
  ctx.state.currentRole = userRoles[0].name;
  ctx.headers['x-role'] = userRoles[0].name;
}
```

Every other unheld name reaches `:74-81` and is thrown out with
`ctx.throw(401, { code: 'ROLE_NOT_FOUND_FOR_USER', ... })`.
`UNION_ROLE_KEY = '__union__'` (`plugin-acl/src/server/constants.ts:10`).

## Raw captures

- `raw/UNION-REWRITE.json` — full transcript, the two raw response texts compared, both `roleMode` readings
- `raw/probe.stdout.txt`
