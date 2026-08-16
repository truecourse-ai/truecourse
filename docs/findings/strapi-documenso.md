# Strapi and Documenso findings (August 2026)

Two SaaS targets run through the guard pipeline (spec scan, scenario generation, guard run) on 2026-08-13 and 2026-08-14, followed by hand verification against a live server, a source-level root cause, and a tracker cross-check.

| Target | Version tested | Surface | Scenarios (last run) | Verified findings |
|---|---|---|---|---|
| [strapi/strapi](https://github.com/strapi/strapi) | 5.52.0, `develop` @ `c43e9ee1e2` | the new MCP server (AI read/write of CMS content) + admin-token auth | 81 run, 62 pass, 19 fail | **8**, all previously unreported |
| [documenso/documenso](https://github.com/documenso/documenso) | 2.16.0, `release` @ `3cf2963cd0` | v2 signing API (envelope, recipients, fields, send, sign) + web signing UI | 49 run, 31 pass, 18 fail | **8** itemized below (6 unreported, 2 already known via community PR #3136) |

Legend for the tables: **Type** is what kind of defect it is. **Introduced by** is the PR/commit whose lines were git-blamed as the cause. **Fixed** and **Reported** are the upstream state at research time.

## Strapi 5.52.0

All eight are places where Strapi's own docs promise one thing and the MCP server or admin-token code does another, or silently does the wrong thing. None is on Strapi's public issue tracker; none is fixed in 5.52.0. Every code-side finding traces to PRs by the same author in the April to June 2026 admin-token + MCP feature window: new-feature bugs, not regressions in old code.

| # | Finding | Type | Introduced by | Fixed | Reported | Scenario |
|---|---|---|---|---|---|---|
| 1 | **Admin-token permissions silently vanish on restart.** Permissions granted to a token through the API are deleted by the next server restart; the token still authenticates but can do nothing, no error. | Code bug: silent security-scope loss | PR #25657 "api token supports admin permissions and admin user ownership" (`52b8fd9e3d`, 2026-04-29). Added token permissions but never taught the pre-existing boot-time cleanup (from PR #18232, 2023) about them, so they get reaped. The bug is the interaction. | No | No | `a-permission-configured-through-the-admin-api-does-not-outlive-a-restart.api.1` |
| 2 | **"Clear all relationships" (`set: null`) is a no-op.** The documented way to remove all links returns success and changes nothing. | Code bug: silent data integrity | PR #26371 "introduce MCP server" (`d6f693da85` + `9247b9b093`, 2026-05-27), `data-schema.ts` | No | No | `relations-are-written-through-connect-disconnect-and-set.api.1` |
| 3 | **Conflicting relationship ops are silently half-applied.** Two mutually exclusive ops in one call (docs say forbidden) are accepted and one is dropped. | Code bug: silent divergence between intent and stored state | PR #26371, same relation schema | No | No | `relations-are-written-through-connect-disconnect-and-set.api.1` |
| 4 | **`$null` / `$notNull` filters reject the input the rest of Strapi requires**, and mis-handle the workaround. Documented operators unusable as documented. | Code bug: docs-vs-behavior | PR #26371, `filters-schema.ts` (every operator inherits the field's value type) | No | No | `the-filter-operators-the-docs-enumerate.api.1` |
| 5 | **The post-update reply shows the relation field empty** even though the change saved. An agent concludes its write failed and may retry. | Code bug: wrong confirmation | PR #26560 "reduce MCP relation output to identity-only shape" (`00da31ed44`, 2026-06-19) set the output shaping; the handler itself is from #26371 | No | No | `relations-are-written-through-connect-disconnect-and-set.api.1` |
| 6 | **Default page size contradicts the tool's own schema.** Schema says 25 per page; the product returns 10 (REST API returns 25). | Contract bug: schema-vs-behavior | PR #26371, `input-schemas.ts` | No | No | `the-list-tool-paginates-its-results.api.1` |
| 7 | **Raw SQL leaks to the client on a write error**, column names and values included. | Security: information disclosure | PR #26371, `tool-registry.ts` (echoes the raw error verbatim) | No | No | `the-filter-operators-the-docs-enumerate.api.1` |
| 8a | **Admin-token secret key is returned on every read**; docs say it is shown only once. | Docs-vs-code drift, security-relevant | Code side: PR #25657, `controllers/admin-token.ts`. The doc text lives in the strapi/documentation repo (not blamed, repo not checked out). | No | No | `an-admin-token-authenticates-the-admin-api-and-its-key-is-read-back.api.1` |
| 8b | **Documented tool names and permission requirements do not match the product** (the discard-tool permission mismatch, and "configured entirely from the admin panel"). | Docs bug (the code mapping is correct and old, PR #19380, 2024) | Wrong text lives in the strapi/documentation repo; needs that repo to blame. | No | No | `the-two-draft-and-publish-tools-the-docs-scope-to-the-publish-permission.api.1` |

Roll-up: 7 code-side defects on 3 PRs (#26371 x5, #25657 x2, #26560 x1), 1 pure docs defect. Impact classes: silent data loss or silent scope loss (#1, #2, #3), information disclosure (#7), wrong contract (#4, #5, #6), wrong docs (#8).

## Documenso 2.16.0

From the published docs the pipeline extracted 1,186 testable claims and authored 49 scenarios; every one of the 18 failures on the final board is an adjudicated finding. Per the research: 6 previously unreported defects, 5 independently confirmed by community PRs unmerged for two weeks, and 2 fixed upstream within days of the tested build. The eight itemized below are the ones the feedback names.

| # | Finding | Type | Introduced by | Fixed | Reported | Scenario |
|---|---|---|---|---|---|---|
| 1 | **Field-move requests are silently dropped.** `POST /envelope/field/update-many` returns 200 and moves nothing (the route reads one set of coordinate names, the service writes another). Still broken on `main`. | Code bug: silent no-op | not blamed | No (fix PR open, unmerged) | Yes: community PR [#3136](https://github.com/documenso/documenso/pull/3136), found independently ~2 weeks earlier | `move-and-delete-a-field-on-a-draft.api.1` |
| 2 | **A partial field update wipes configuration.** Updating one property of a radio/checkbox/dropdown field resets its options to defaults behind a 200. | Code bug: silent data loss | not blamed | No | No | `move-and-delete-a-field-on-a-draft.api.1` |
| 3 | **"Frozen after sending" isn't.** Docs say recipients and fields cannot change once sent; the API adds a recipient to a PENDING document. | Code bug: docs-vs-behavior, silent | not blamed | No | No | `a-draft-accepts-changes-and-a-sent-document-refuses-them.api.1` |
| 4 | **Coordinates go out as numbers, come back as JSON strings.** Docs, the API's own schema, and the wire disagree. | Contract bug: schema-vs-wire | not blamed | No (PR #3136 carries a docs-only patch; the API is unchanged) | Partly: PR [#3136](https://github.com/documenso/documenso/pull/3136) documents it, no issue | `place-fields-on-a-draft-by-coordinates.api.1` |
| 5 | **Every API error is labeled `INTERNAL_SERVER_ERROR`.** A 404 or a 400 carries the real code one level down; the top-level code is always the same. | Code bug: error envelope | not blamed | No | No | `the-documented-error-envelope-on-an-unknown-envelope.api.1` |
| 6 | **"Immediately rejected" is eventually rejected.** Rejection is written by an async job; the very next read still says Pending. | Docs-vs-behavior (async) | not blamed | No | No for the normal case; a related edge (a stuck job) is filed upstream | `reject-a-document-on-a-recipients-behalf.api.1` |
| 7 | **The send screen promises signing links and shows none.** Docs say the page displays each recipient's link after a manual send; they are copy-to-clipboard behind an unlabeled control. | Web UI: docs-vs-behavior | not blamed | No | No | `a-none-distribution-send-offers-the-signing-links.web.1` |
| 8 | **Two controls have no accessible name** (API-token expiry selector, "Copy Signing Links"). Unreachable by assistive tech and by fair automation; the pattern (control wired to a label pointing at nothing) is app-wide. | Accessibility | not blamed | No | No | `the-token-expiry-choices-the-docs-list.web.1`, `a-none-distribution-send-offers-the-signing-links.web.1` |

Roll-up: 6 API defects (#1 to #6), 2 web/accessibility (#7, #8). Silent data loss: #1, #2, #3. Known upstream before us: #1 and #4 via PR #3136 (unmerged). Everything else unreported.

## Gaps still to fill from the research

- Documenso: no git-blame yet, so **Introduced by** is empty for all eight.
- Documenso: the headline counts 5 community-confirmed and 2 fixed-upstream findings, but only PR #3136 (#1, #4) is itemized. The other community PRs and the 2 fixed items are not named in the feedback.
- Documenso #6: the filed "stuck job" issue number is not given.
- Strapi #8a/#8b: the doc-side blame needs the strapi/documentation checkout.
