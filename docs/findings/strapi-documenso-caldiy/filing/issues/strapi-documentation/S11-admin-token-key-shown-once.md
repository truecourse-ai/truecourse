---
finding: S11
target: strapi/documentation
route: docs repo issue
title: "[Bug]: Admin tokens page states the plaintext key is shown only once and that the encryption key does not apply to Admin tokens; both are false"
labels: type: bug
status: draft
reverified: yes (product: Strapi 5.52.1, develop @ c7dbadd4feec41f0d3892c1bc9f5435e7aad3672; docs: strapi/documentation main @ 9226f90506a4a361038f220f24768016a73b5663, both 2026-08-19)
---

# [Bug]: Admin tokens page states the plaintext key is shown only once and that the encryption key does not apply to Admin tokens; both are false

## Link to the documentation page or resource

https://docs.strapi.io/cms/features/admin-tokens (the `:::caution` block in "Creating a new Admin token", and the "Configuration" paragraph above it)

Source file: `docusaurus/docs/cms/features/admin-tokens.md`, lines 88 to 90 and line 49 on `main` at `9226f90506a4a361038f220f24768016a73b5663`.

## Describe the bug

### 1. The caution block, line 89

The page says:

> The plaintext token key is shown only once, immediately after creation or regeneration. The `admin.secrets.encryptionKey` configuration that makes Content API token keys persistently viewable does not apply to Admin tokens. Admin token keys are always restricted to the token owner, regardless of encryption configuration.

The first two sentences are false in a default Strapi 5 install. The third is true.

What the product does: `GET /admin/admin-tokens/:id` returns the token's decrypted `accessKey` on **every** read, not only the first one. `packages/core/admin/server/src/controllers/admin-token.ts` lines 138 to 160 load the token, and when the caller owns it, re-read it as `apiTokenService.getById(id, { includeDecryptedKey: true })` and send that:

https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/admin/server/src/controllers/admin-token.ts#L138-L160

`getBy` in `packages/core/admin/server/src/services/api-token.ts` (lines 615 to 664) adds `encryptedKey` to the select and assigns `accessKey = encryption.decrypt(token.encryptedKey)` at lines 659 to 661. The `encryptedKey` column is written unconditionally on every admin-token create (lines 752 to 754 and 830 to 841) and on regenerate (lines 864 to 876).

The encryption key is not opt-in either, which is what makes the second sentence wrong in the opposite direction: `packages/core/admin/server/src/services/encryption.ts` reads `admin.secrets.encryptionKey`, and `create-strapi-app` generates that key into `.env` for every new project (`packages/cli/create-strapi-app/src/utils/dot-env.ts` lines 19 and 41). So `admin.secrets.encryptionKey` is exactly what makes Admin token keys persistently viewable, and it is present by default.

The admin panel is not an exception to this. `packages/core/admin/admin/src/pages/Settings/pages/AdminTokens/EditView/EditViewPage.tsx` derives `canShowToken` from the `accessKey` that the same GET returns (line 238) and wires an eye control that re-reveals it (line 229). The sentence is therefore wrong about the UI it was written for, not only about the API.

The third sentence holds: a super admin reading another user's admin token gets the record without the key (controller line 159).

Observed on a live instance. `GET /admin/admin-tokens/:id` on Strapi 5.52.1 answered `200` with `data.accessKey` present and byte-identical to the 256-character key issued at creation, on three consecutive reads. The collection route `GET /admin/admin-tokens` does not include `accessKey`, so the readback is specific to get-by-id.

The access-control consequences of this behavior have been reported privately to the Strapi security team through GitHub Security Advisories, per `SECURITY.md`. This issue is only about the documentation text and deliberately does not restate that report.

### 2. The Configuration paragraph, line 49

The same page says the shared encryption key is set via `apiToken.secrets.encryptionKey` in `/config/admin`. The code reads `admin.secrets.encryptionKey`, that is `secrets.encryptionKey` at the top level of `/config/admin`, in `packages/core/admin/server/src/services/encryption.ts`. The sibling API tokens page already documents it correctly at https://docs.strapi.io/cms/features/api-tokens ("an encryption key must be provided in your `/config/admin` file under `secrets.encryptionKey`"), and the caution block four lines below on this very page also writes `admin.secrets.encryptionKey`. So the page contradicts itself and its sibling.

### How this was checked

- Product: Strapi 5.52.1, `strapi/strapi` develop @ `c7dbadd4feec41f0d3892c1bc9f5435e7aad3672`, started with `yarn workspace getstarted start` (production start, not `strapi develop`), sqlite, node v24.14.1. First observed on 5.52.0 @ `c43e9ee1e20f613b63f8f10d9e52be062a8b4a72`. `git log c43e9ee1e2..origin/develop -- packages/core/admin/server/src` is empty, so the two builds are identical here.
- Docs: text quoted verbatim from `main` @ `9226f90506a4a361038f220f24768016a73b5663`, re-checked 2026-08-19.

## Suggested improvements or fixes

Replace the caution block (line 89) with the actual behavior, for example:

> An Admin token's plaintext key remains retrievable by its owner for as long as `admin.secrets.encryptionKey` is unchanged, exactly as for Content API tokens: the key is re-displayed in the admin panel and returned by `GET /admin/admin-tokens/:id`. Rotating `admin.secrets.encryptionKey` makes existing keys unreadable. Admin token keys are restricted to the token owner: a super admin reading another user's Admin token does not see the key.

Treat the key as a stored secret in the surrounding prose too, since the current wording tells operators the opposite.

Fix line 49 to name `secrets.encryptionKey` under `/config/admin` (that is `admin.secrets.encryptionKey`), matching the API tokens page and the caution block below it. `apiToken.salt` in the same sentence is correct and should stay.

## Related issue(s)/PR(s)

- strapi/documentation#2992 (merged 2026-05-06, commit `f0b2fd2c5d`), "Admin tokens", created this page with the caution already in it, one week after the code shipped.
- strapi/strapi#25657 (merged 2026-04-29, commit `52b8fd9e3d`), "feat(admin): api token supports admin permissions and admin user ownership", the only commit that has ever touched `controllers/admin-token.ts` and the origin of the readback branch. Not a fix, cited to identify the code the page describes.
- No open issue or PR in either repository reports this text. Searched 2026-08-19: `admin token accessKey`, `admin token plaintext key shown once` (both 0 results), plus a full enumeration of `strapi/documentation` issues since 2026-08-01 (40 items, none touching `admin-tokens.md`).

Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
