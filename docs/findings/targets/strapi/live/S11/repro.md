# S11 live re-verification: the admin-token key is returned on every read, and a read-only token harvests its owner's other tokens

- **Date:** 2026-08-19
- **Build:** strapi/strapi `develop` @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672` (2026-08-19 17:01 +0200). Instance reports Strapi 5.52.1, node v24.14.1.
- **How started:** `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`.
- **Verdict: still reproduces, and the escalation the review flagged as "verified in source but not exercised" is now exercised and confirmed.**

Access keys are 256 hex characters. They are masked in the captures as `<first 8>...<last 6> (len 256)`; the comparisons below are done in the script against the full value.

## Seed for this scenario

Super admin `tc-reverify@example.com` (admin user id 1) creates both tokens, so both are owned by the same user, which is the ordinary case for a machine credential.

- **wide token**, id 7, `tcref-wide-mt0gab6i`: `plugin::content-manager.explorer.{read,create,update,delete}` on `api::article.article`
- **narrow token**, id 8, `tcref-narrow-mt0gab6i`: exactly one permission, `admin::admin-tokens.read`

Both `POST /admin/admin-tokens` calls answered `201`, and the narrow token's permission list came back as exactly `["admin::admin-tokens.read"]`, so an admin token can indeed hold that action. Raw captures: `step-1.create-wide-token.json`, `step-2.create-narrow-token.json`.

## Part A: the documented claim, the key is "shown only once"

### 1. The narrow token reads its own record

```
GET /admin/admin-tokens/8
Authorization: Bearer <narrow token accessKey, redacted>
```

`200 OK`, and `data.accessKey` is present and **identical to the key issued at creation**. Raw capture: `step-3.narrow-reads-itself.json`.

### 2. Repeated reads by the super admin keep returning it

Three consecutive `GET /admin/admin-tokens/7` with the super-admin jwt: `200` each time, `accessKey` present each time, identical to the key issued at creation each time. Raw capture: `step-7.super-admin-repeat-read.json`.

### 3. The list route does not carry it

`GET /admin/admin-tokens` -> `200`, and no element of `data` has an `accessKey` property. Raw capture: `step-8.list-route.json`. The disclosure is specific to the get-by-id route, as the original run found.

## Part B: the escalation

### 4. The narrow token reads a sibling it does not own the scope of

```
GET /admin/admin-tokens/7
Authorization: Bearer <narrow token accessKey, redacted>
```

`200 OK`. The body carries:

- `data.accessKey`, **identical to the wide token's plaintext key**
- `data.adminPermissions`, listing `plugin::content-manager.explorer.read`, `.create`, `.update`, `.delete` on `api::article.article`

So a credential whose only granted action is `admin::admin-tokens.read` reads back another token's secret in plaintext, together with a map of what that secret is good for. Raw capture: `step-4.narrow-reads-wide-sibling.json`.

### 5. The narrow token really is read-only

```
POST /admin/admin-tokens
Authorization: Bearer <narrow token accessKey, redacted>
```

`403 Forbidden`. It cannot mint or edit tokens; it can only read them, and reading is enough. Raw capture: `step-6.narrow-cannot-write.json`.

### 6. The harvested key grants capability the harvester never had

`tools/list` on `POST /mcp` with each credential:

| credential | tools served |
|---|---|
| narrow token (`admin::admin-tokens.read`) | `[]` |
| the key it read out of token 7 | `list_article`, `get_article`, `create_article`, `update_article`, `delete_article`, `discard_article_draft` |

Then `tools/call create_article` with the harvested key: `200 OK`, `isError: false`, the article was created. Raw captures: `step-9.capability-gained-by-the-stolen-key.json`, `step-10.stolen-key-writes.json`.

The narrow token could do nothing. One `GET` later it can create, update and delete content.

### 7. Scope note

`GET /admin/admin-tokens` with the harvested key returns `403`, because the wide token does not itself hold `admin::admin-tokens.read`. That is the expected boundary and it does not weaken the escalation: the gain is the content-manager rights, not further token reads. Raw capture: `step-5.stolen-key-authenticates.json`.

## Comparison with the original transcript

The original (evidence `2026-08-14T15-07-53Z_74b6e3f2`, failing step 5) observed only the harmless half, a token reading its own record and getting its own key back. Part A here matches that exactly. Part B is the step the review said "one extra request would settle": it was not run in August, it is run here, and it lands as predicted. The review's mechanism holds too, since `isTokenOwner` compares the authenticating token's owner against the requested token's owner rather than requiring the two tokens to be the same.

## Source state on the re-verified build

`packages/core/admin/server/src/controllers/admin-token.ts` and `.../routes/admin-tokens.ts` are unchanged from the tested build: the get-by-id route is gated by `admin::isAuthenticatedAdmin` plus `hasPermissions({admin::admin-tokens.read})`, and ownership is checked against the requesting user rather than the requesting token.

## Verdict

**still reproduces**, with the scope now enlarged by direct observation. What was filed as a documentation drift (the docs say the key is shown once) is, on a live 5.52.1, also a privilege-escalation path between sibling admin tokens of the same owner. This should change the finding's routing: the escalation is worth a security report rather than a docs PR, and the docs fix is the secondary half.
