---
finding: S12
target: strapi/documentation
route: docs repo issue
title: "[Bug]: MCP server tool tables list `publish` as the permission required for discard_draft; the product requires `update`"
labels: type: bug
status: draft
reverified: yes (source and doc text re-checked 2026-08-19: strapi/strapi develop @ c7dbadd4feec41f0d3892c1bc9f5435e7aad3672 unchanged, strapi/documentation main @ 9226f90506a4a361038f220f24768016a73b5663 still carries both cells; product behavior observed on 5.52.0, not re-run live)
---

# [Bug]: MCP server tool tables list `publish` as the permission required for discard_draft; the product requires `update`

## Link to the documentation page or resource

https://docs.strapi.io/cms/features/strapi-mcp-server (Usage > Available tools > Content management tools)

Source file: `docusaurus/docs/cms/features/strapi-mcp-server.md`, line 233 (collection types) and line 244 (single types) on `main` at `9226f90506a4a361038f220f24768016a73b5663`.

## Describe the bug

Both tool tables carry the same wrong cell:

> \| `discard_draft` \| Discard draft \| `publish` \| Discard draft changes and revert to the published version \|

- collection types: https://github.com/strapi/documentation/blob/9226f90506a4a361038f220f24768016a73b5663/docusaurus/docs/cms/features/strapi-mcp-server.md#L233
- single types: https://github.com/strapi/documentation/blob/9226f90506a4a361038f220f24768016a73b5663/docusaurus/docs/cms/features/strapi-mcp-server.md#L244

The permission the product actually requires for `discard_draft` is `update`, not `publish`.

**What the product does.** `packages/core/content-manager/server/src/services/permission-checker.ts` lines 6 to 14 map the actions: `publish` and `unpublish` both resolve to `plugin::content-manager.explorer.publish` (lines 11 and 12), and `discard` resolves to `plugin::content-manager.explorer.update` (line 13).

https://github.com/strapi/strapi/blob/c7dbadd4feec41f0d3892c1bc9f5435e7aad3672/packages/core/content-manager/server/src/services/permission-checker.ts#L6-L14

The MCP tool definitions consume that map directly: `derive-content-type-mcp-tools.ts` attaches `auth: { policies: [{ action: ACTIONS.discard, subject: uid }] }` to `discard_<slug>_draft` at line 296 for collection types and line 504 for single types, against `ACTIONS.publish` at lines 278 and 486 and `ACTIONS.unpublish` at lines 287 and 495. A session only receives a tool whose policy its ability satisfies (`packages/core/core/src/services/mcp/internal/syncMcpSessionCapabilities.ts` lines 28 to 52), so an unsatisfied policy removes the tool from the listing entirely, which is what the page's own "Permission boundaries" section describes.

This is not MCP-specific. The admin REST routes for discard require `plugin::content-manager.explorer.update` (`routes/admin.ts` lines 187 to 196 for single types, 367 to 376 for collection types), the controllers gate on `permissionChecker.cannot.discard()` which resolves to the same update action (`controllers/collection-types.ts` lines 909 to 943), and the admin panel disables the Discard button on `canUpdate` (`admin/src/pages/EditView/components/DocumentActions.tsx` lines 1719 to 1729). Three independent code paths agree: discarding a draft is an update on the draft. The product is internally consistent; the table cell is the only wrong part.

**Observed.** On Strapi 5.52.0 (develop @ `c43e9ee1e20f613b63f8f10d9e52be062a8b4a72`, started with `yarn workspace getstarted start`, sqlite), an admin token holding exactly `plugin::content-manager.explorer.read` and `plugin::content-manager.explorer.publish` on `api::article.article` was served exactly four tools by `tools/list`: `list_article`, `get_article`, `publish_article`, `unpublish_article`. `discard_article_draft` was absent. Two byte-identical `tools/list` calls one after the other returned the same set, so the absence is not timing or caching. An operator who mints a read plus publish token from this table gets no `discard_draft` tool and no error explaining why.

**Re-verified on 2026-08-19.** `git log c43e9ee1e2..origin/develop -- packages/core/content-manager/server/src/services/permission-checker.ts packages/core/content-manager/server/src/mcp/derive-content-type-mcp-tools.ts` is empty, so the mapping is unchanged through 5.52.1, and both table cells are verbatim on `main` at lines 233 and 244. The behavior itself was not re-run on 5.52.1.

**Secondary point for the same tables.** The tables imply every row has its own permission, but `unpublish` does not: `ACTIONS.unpublish` is literally the same string as `ACTIONS.publish`. The `unpublish` row's `publish` cell is right only by that aliasing, and there is no way to grant `publish` without also granting `unpublish`. Worth a sentence under the tables so readers do not try to separate them.

## Suggested improvements or fixes

Change the `Permission required` cell for `discard_draft` from `publish` to `update` in **both** tables, line 233 and line 244. Patching only the collection-type table leaves the single-type table wrong.

Optionally add one sentence after the tables: discarding a draft is an update on the draft, which is why the admin panel's Discard button is likewise gated on `update`; and `publish` grants both the `publish` and `unpublish` tools, because they share a single permission.

## Related issue(s)/PR(s)

- strapi/documentation#3194 (merged 2026-05-28, commit `a3b573cfd9b0`), "Strapi MCP server for content management". Created the page with the wrong cell already in both tables. Origin, not a fix.
- strapi/strapi#26371 (merged 2026-05-27, commit `d6f693da85`), "feat(*): introduce MCP server". Wired `discard_<slug>_draft` to `ACTIONS.discard`. Correct behavior, cited only to identify the code the table misdescribes.
- The mapping itself predates MCP: `ACTIONS.discard = explorer.update` comes from strapi/strapi#19380 ("feat(cm): D&P pt2", commit `4f4e3c3acd12`, 2024-02-22).
- No existing issue or PR reports this. Searched 2026-08-19: `discard_draft` across the org (1 hit, strapi/strapi#26444 on MCP telemetry, unrelated), `MCP permission required` in this repo (0 results), plus a full enumeration of both repositories' recent issues.

Found by TrueCourse running the published MCP server documentation against a live instance; the full transcript (requests, responses, server log) is available on request.
