---
finding: S11
target: strapi/strapi
route: security disclosure
title: An admin token holding only admin::admin-tokens.read reads back a sibling token's plaintext key and gains its permissions
labels: none (GHSA advisory, not a labelled issue)
status: filed
filed_url: https://github.com/strapi/strapi/security/advisories/GHSA-h3c5-gq5q-4q3m
filed_ghsa: GHSA-h3c5-gq5q-4q3m
filed_at: 2026-08-19
filed_note: private advisory, state=triage, severity=high. Not public; the sibling docs issue for the "shown only once" text stays unfiled until this is triaged.
reverified: yes (Strapi 5.52.1, develop @ c7dbadd4feec41f0d3892c1bc9f5435e7aad3672, 2026-08-19)
---

# An admin token holding only `admin::admin-tokens.read` reads back a sibling token's plaintext key and gains its permissions

Private report via GitHub Security Advisories at https://github.com/strapi/strapi/security/advisories/new, the only intake channel accepted by SECURITY.md.

## Summary

`GET /admin/admin-tokens/:id` returns the requested token's decrypted `accessKey` on every read, not only at creation. The route is gated on `admin::isAuthenticatedAdmin` plus the single permission `admin::admin-tokens.read`, and the ownership check compares the *authenticating user* against the *requested token's owner*, not the authenticating token against itself. An admin token whose only granted action is `admin::admin-tokens.read` can therefore read back the full plaintext key of any other admin token owned by the same admin user, together with that token's permission list, and then act with those permissions. On a live 5.52.1 instance a token that could do nothing but read token records obtained a sibling token's key and used it to list and call six content-manager MCP tools, creating an article. The documentation states the opposite guarantee, that the plaintext key "is shown only once, immediately after creation or regeneration", so operators are not told that a read-scoped admin token is key material.

## Affected Versions

- Reproduced on **5.52.0** (develop @ `c43e9ee1e20f613b63f8f10d9e52be062a8b4a72`, 2026-08-13) and re-verified on **5.52.1** (develop @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, 2026-08-19). Both runs used `yarn workspace getstarted start`, that is production start, not `strapi develop`.
- The code path arrived with PR #25657, `feat(admin): api token supports admin permissions and admin user ownership`, commit `52b8fd9e3d47132f52ae910d32a6ee25961c5f32`, 2026-04-29. That commit is the only one that has ever touched `packages/core/admin/server/src/controllers/admin-token.ts`, and it already contains the `includeDecryptedKey` branch, so every GA release carrying admin tokens with admin permissions is expected to be affected. Only 5.52.0 and 5.52.1 were tested.
- `git log c43e9ee1e2..origin/develop -- packages/core/admin/server/src` is empty, so the controller, the service, the routes and the auth strategy are byte-identical between the two tested builds.

## Vulnerability Details

Three pieces combine.

1. **The key is stored decryptable by default.** `packages/core/admin/server/src/services/api-token.ts` writes `encryptedKey` unconditionally on every admin-token create (lines 752-754 and 830-841) and on regenerate (lines 864-876). `packages/core/admin/server/src/services/encryption.ts` reads `admin.secrets.encryptionKey`, and `create-strapi-app` generates that key into `.env` for every new project (`packages/cli/create-strapi-app/src/utils/dot-env.ts` lines 19 and 41). So a default install can always decrypt an admin token key. There is no opt-in step.

2. **The get-by-id controller returns the decrypted key.** `packages/core/admin/server/src/controllers/admin-token.ts` lines 138-160: the handler loads the token without the key, refuses non-owner non-super-admins with a 404, and then, when `isTokenOwner(ctx.state.user, token)` is true, deliberately re-reads the row as `apiTokenService.getById(id, { includeDecryptedKey: true })` and sends it. `getBy` in `services/api-token.ts` (lines 615-664) adds `encryptedKey` to the select and assigns `accessKey = encryption.decrypt(token.encryptedKey)` at lines 659-661.

   Permalink at the tested commit: https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/admin/server/src/controllers/admin-token.ts#L138-L160
   Same lines at today's head: https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/admin/server/src/controllers/admin-token.ts#L138-L160

3. **The ownership check does not bind the request to the authenticating token.** `packages/core/admin/server/src/routes/admin-tokens.ts` lines 36-45 gate `GET /admin-tokens/:id` on `admin::isAuthenticatedAdmin` plus `admin::hasPermissions` with `{ actions: ['admin::admin-tokens.read'] }` and nothing else. `packages/core/admin/server/src/strategies/admin-token.ts` line 24 sets `ctx.state.user` to the token's **owner** user object (`authenticateAdminToken`, `services/api-token.ts` lines 703-727). `isTokenOwner` then compares that owner against the owner of the **requested** token id. Two tokens minted by the same admin user pass that comparison for each other, so holding `admin::admin-tokens.read` on token B is sufficient to read token A's secret.

The consequence is a privilege boundary that does not exist: the permission `admin::admin-tokens.read` implicitly grants every permission held by every other admin token of the same owner. The docs recommend admin tokens precisely for MCP agents and CI jobs, so a narrowly scoped machine credential handed to an agent is a path to that owner's wider credentials.

The doc clause the code does honor is human owner scoping: a super admin reading another user's admin token gets the record without the key (controller line 159).

## Proof of Concept

Environment: `strapi/strapi` develop @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, instance reports Strapi 5.52.1 on node v24.14.1, started with `PORT=1347 STRAPI_TELEMETRY_DISABLED=true corepack yarn workspace getstarted start`, sqlite at `examples/getstarted/.tmp/data.db`. Production start, `autoReload` off. Access keys are 256 hex characters and are masked below as `<first 8>...<last 6> (len 256)`; the equality comparisons were made on the full values.

**Step 1. As one super admin (`tc-reverify@example.com`, admin user id 1), mint two admin tokens.**

Both created through `POST /admin/admin-tokens` with the super admin's JWT, both owned by that same admin user, which is the ordinary case for machine credentials.

```
token id 7  "wide"    permissions: plugin::content-manager.explorer.read
                                   plugin::content-manager.explorer.create
                                   plugin::content-manager.explorer.update
                                   plugin::content-manager.explorer.delete   (subject api::article.article)
            201 Created, accessKey 89349998...776d4f (len 256)

token id 8  "narrow"  permissions: admin::admin-tokens.read      (exactly one, no subject)
            201 Created, accessKey 7d21038e...f8a3e6 (len 256)
```

**Step 2. The narrow token reads its own record and the key comes back.**

```
GET /admin/admin-tokens/8
Authorization: Bearer 7d21038e...f8a3e6
```

```
200 OK
data keys: id, kind, name, description, lastUsedAt, lifespan, expiresAt,
           createdAt, updatedAt, adminPermissions, adminUserOwner, accessKey
data.accessKey = 7d21038e...f8a3e6   (identical to the key issued at creation)
```

Three consecutive `GET /admin/admin-tokens/7` with the super admin's JWT likewise answer `200` with the same `accessKey` every time. The collection route `GET /admin/admin-tokens` does not carry `accessKey`, so the disclosure is specific to get-by-id.

**Step 3. The narrow token reads the sibling it has no relationship to.**

```
GET /admin/admin-tokens/7
Authorization: Bearer 7d21038e...f8a3e6      <- the narrow token, admin::admin-tokens.read only
```

```
200 OK
{
  "data": {
    "id": 7,
    "kind": "admin",
    "name": "tcref-wide-mt0g9z3k",
    "lifespan": null,
    "expiresAt": null,
    "adminPermissions": [
      { "action": "plugin::content-manager.explorer.read",   "subject": "api::article.article", ... },
      { "action": "plugin::content-manager.explorer.create", "subject": "api::article.article", ... },
      { "action": "plugin::content-manager.explorer.update", "subject": "api::article.article", ... },
      { "action": "plugin::content-manager.explorer.delete", "subject": "api::article.article", ... }
    ],
    "adminUserOwner": { "id": 1, "email": "tc-reverify@example.com", ... },
    "accessKey": "89349998...776d4f (len 256)"
  }
}
```

`data.accessKey` is byte-identical to the key issued for token 7 in step 1, and `adminPermissions` tells the reader exactly what that key is good for.

**Step 4. Confirm the narrow token is genuinely read-only.**

```
POST /admin/admin-tokens
Authorization: Bearer 7d21038e...f8a3e6
```

```
403 Forbidden
{"data":null,"error":{"status":403,"name":"PolicyError","message":"Policy Failed","details":{}}}
```

It cannot mint or edit tokens. Reading is enough.

**Step 5. The harvested key grants capability the harvester never had.**

`tools/list` on `POST /mcp` with each credential:

| credential | tools served |
|---|---|
| narrow token (`admin::admin-tokens.read`) | `[]` |
| the key read out of token 7 | `list_article`, `get_article`, `create_article`, `update_article`, `delete_article`, `discard_article_draft` |

Then `tools/call` `create_article` with the harvested key:

```
200 OK, isError: false
{"data":{"id":10,"documentId":"lrj3xq4vjhvnrwnqn4y4vf8e","title":"tc-escalation-proof-mt0gag7z", ...}}
```

The article was created. The credential that started with one read permission now writes content.

**Boundary note.** `GET /admin/admin-tokens` with the harvested key answers `403`, because token 7 does not itself hold `admin::admin-tokens.read`. The gain is the content-manager rights, not further token reads.

**Dependency note.** Steps 1 to 4, the disclosure and the escalation, use only the admin REST API, which is always on. Step 5 uses the MCP surface because it renders the capability gain in a single listing; that surface is gated by `server.mcp.enabled` (`McpConfiguration.isEnabled()`), which the tested app opts into. Nothing in this report depends on `strapi develop` or on `autoReload`: the route, the controller branch and the auth strategy are unconditional.

## Impact

- Any holder of an admin token scoped to `admin::admin-tokens.read` obtains the plaintext key, and therefore the full permission set, of every other admin token owned by the same admin user. Read access to token metadata is not separable from possession of the secrets.
- The keys are long-lived. Both tokens in the proof of concept have `lifespan: null` and `expiresAt: null`, the default, so a harvested key stays valid until someone regenerates it.
- The audit trail attributes the harvester's later actions to the harvested token, not to the token that performed the read.
- The published documentation removes the operator's chance to compensate. https://docs.strapi.io/cms/features/admin-tokens states "The plaintext token key is shown only once, immediately after creation or regeneration" and that the encryption-key configuration "does not apply to Admin tokens". Both clauses are false in a default install, so an operator who leaks or shares a read-scoped admin token, or an admin panel session, has no reason to treat it as key-material exposure. A separate documentation issue is being filed against `strapi/documentation` for that text; it links here and does not restate this reproduction.
- The intended audience makes it worse rather than better: admin tokens are documented as the credential for MCP agents and CI, which is exactly where a deliberately narrow token is handed to third-party code.

## Suggested CVSS 4.0

`CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N` (High).

Rationale for the metrics: the admin API is reachable over the network (AV:N); no special conditions or races are needed, one GET suffices (AC:L, AT:N); the attacker must hold a valid, deliberately low-privileged admin token (PR:L); no admin has to do anything (UI:N); the disclosed secret is another credential in full (VC:H) and using it yields that credential's write permissions (VI:H); no availability effect was demonstrated (VA:N). Score band offered as a suggestion, the maintainers may weigh PR differently if a read-scoped admin token is considered a lower or higher starting privilege in their model.

## Suggested remediation

Two independent changes, either of which closes the escalation:

1. In `controllers/admin-token.ts`, return the decrypted key only when the requested token **is** the authenticating token, or only for an interactive (JWT) admin session, rather than for any request whose authenticating user happens to own the requested token.
2. Bind admin-token authentication to itself: when `ctx.state.user` was populated by the admin-token strategy, refuse `includeDecryptedKey` entirely. A machine credential arguably should never be able to read any key, including its own.

Separately, `admin::admin-tokens.read` should be documented, or renamed, as a permission that confers read access to secrets, since that is what it does today.

## Related

- PR #25657 (merged 2026-04-29, commit `52b8fd9e3d`), `feat(admin): api token supports admin permissions and admin user ownership`. Origin of the code path.
- strapi/documentation PR #2992 (merged 2026-05-06, commit `f0b2fd2c5d`) created `docusaurus/docs/cms/features/admin-tokens.md` with the incorrect caution already in it, one week after the code shipped.
- No existing issue or advisory in the `strapi` org matches. Searches on 2026-08-19: `admin token accessKey` (0 results), `admin token plaintext key shown once` (0 results), plus a full enumeration of `strapi/strapi` issues since 2026-08-10 (239 items, none about admin-token key disclosure).

## AI Usage Disclosure

AI tooling was used, and this section is given in the detail SECURITY.md requires.

- **Tools:** TrueCourse, an agentic pipeline that derives executable checks from a product's own published documentation and runs them against a live instance, operating on Anthropic Claude models. No AI-powered vulnerability scanner was used.
- **Discovery:** AI. The pipeline generated a check from the admin-tokens documentation page and ran it against a live Strapi instance; the check failed because the plaintext `accessKey` came back on a read performed minutes after creation.
- **Analysis:** AI, then human review. The escalation path (the ownership check comparing the authenticating user against the requested token rather than against the authenticating token) was derived by reading `controllers/admin-token.ts`, `routes/admin-tokens.ts` and `strategies/admin-token.ts`.
- **Validation:** human-verified. The proof of concept above was executed against a live 5.52.1 instance and every request, status code and response body quoted here was captured from that run. A human confirmed the reproduction and reviewed this report before submission.
- **Drafting:** AI-drafted, human-reviewed.

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
