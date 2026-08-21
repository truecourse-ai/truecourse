# F6 — "New menu items are accessible by default" is true of the two seeded roles only

| | |
| --- | --- |
| checked | 2026-08-20 |
| build | `nocobase/nocobase` `032a4f6913be912f57462d605cbd0bde97b599c6` (`main`, `2.1.45`) |
| instance | `yarn nocobase start --launch-mode node` on 127.0.0.1:14100, PostgreSQL 16 (project `tc-nocobase`, 127.0.0.1:15432) |
| scenario | `new-menu-items-are-accessible-by-default.api.1`, failing step 5 |
| **verdict** | **still reproduces**, both halves |

## Doc, re-read at this SHA

`docs/docs/en/users-permissions/acl/permissions.md:19`, the fifth item under
`### Configuration Permissions`:

> 5. **New menu items are allowed to be accessed by default**: Newly created menus are
>    accessible by default, and this setting is enabled by default.

## Probe — a role minted through the api

```
POST /api/roles:create {"name":"tcnm1","title":"TC New Menu 1"}
→ 200 {"data":{"default":false,"hidden":false,"snippets":["!pm","!pm.*","!ui.*"],
        "name":"tcnm1","title":"TC New Menu 1", ...,
        "allowNewMenu":false,"allowNewMobileMenu":false,"allowNewAiEmployee":true,
        "description":null,"strategy":null,"allowConfigure":null}}

GET /api/roles:get?filterByTk=tcnm1
→ 200 {"data":{ ..., "allowNewMenu":false, ...}}
```

## Control — the roles the installation creates

```
GET /api/roles:list?paginate=false

  admin      | allowNewMenu= true  | default= false | strategy= {"actions":["create","view","update","destroy","export","importXlsx"]}
  member     | allowNewMenu= true  | default= true  | strategy= {"actions":["view:own"]}
  root       | allowNewMenu= false | default= false | strategy= null
  tcnm1      | allowNewMenu= false | default= false | strategy= null      ← api-minted
  tcfldr     | allowNewMenu= false | ...                                   ← api-minted
  tcuniona   | allowNewMenu= false | ...                                   ← api-minted
  tcunionb   | allowNewMenu= false | ...                                   ← api-minted
  tcvieworr  | allowNewMenu= false | ...                                   ← api-minted
```

Same reading straight from postgres (`select name, "allowNewMenu", "default" from roles`).
`admin` and `member`, the two roles the sentence is true of, are `true`. `root` (hidden,
the super-admin role) is `false`, and every role minted through the api on this instance is
`false`.

## Mechanism (re-read at this SHA)

- `plugin-acl/src/server/server.ts:451` and `:458` — `allowNewMenu: true` written literally
  into the `admin` and `member` seed records.
- `plugin-acl/src/server/collections/roles.ts:77-80` — the column is
  `{ type: 'boolean', name: 'allowNewMenu' }` with **no `defaultValue`** (`name` on `:79`).
  `findings.md` cites `:78-81`; the block is `:77-80`.
- `plugin-acl/src/client/NewRole.tsx:46-47` — the New role drawer's `useValues` returns only
  `{ name: 'r_<uid>', snippets: ['!ui.*','!pm','!pm.*'] }`.

## Raw captures

- `raw/F6.json` — the create/get transcript plus every role's `allowNewMenu`
- `raw/probe.stdout.txt`
