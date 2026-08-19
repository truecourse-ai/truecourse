---
finding: D14
target: documenso/documenso
route: comment on existing PR #3137
title: Wire capture for the flat list counters, and the four pages that still publish the pagination wrapper
labels: none (PR comment)
status: draft
reverified: yes (v2.17.0 / 75330166cc, 2026-08-19: still reproduces)
---

# Comment to post on https://github.com/documenso/documenso/pull/3137

Confirmation of the `first-api-call.mdx` pagination hunk in this PR from a live instance, plus where the rest of the same fiction still lives now that #3135 has merged.

Tested against v2.16.0 (tag `v2.16.0`, `3cf2963cd03d8b24770b7490bdb20e596baa5d65`), built and run from source (`npm ci`, `npx turbo run build --filter=@documenso/remix`, `npm run start -w @documenso/remix`) against Postgres 17.

The list endpoint's own Example 1 request:

```
GET /api/v2/envelope?page=1&perPage=10
Authorization: <token>
```

HTTP 200, and the counters are flat on the root object (the `data` array is elided here):

```json
{"data":[ ... 10 envelopes ... ],"count":320,"currentPage":1,"perPage":10,"totalPages":32}
```

There is no `pagination` key at any level, no `page` key and no `totalItems` key, so the two snippets on the page that do `const { data, pagination } = await response.json()` and then read `pagination.totalItems` / `pagination.totalPages` throw a TypeError as written. The names map as `page` to `currentPage` and `totalItems` to `count`, with `perPage` and `totalPages` keeping their names and only losing the nesting level, which is exactly what this PR's replacement block says.

Re-tested live on v2.17.0 (75330166cc, 2026-08-19): still reproduces, scope reduced. The wire has flat counters data/count/currentPage/perPage/totalPages and no pagination object; documents.mdx (the bound page) was corrected by #3135 in v2.17.0, but first-api-call.mdx L81-86 still publishes pagination: {page, perPage, totalPages, totalItems}, as do templates.mdx, teams.mdx and common-workflows.mdx.

The product side is correct against its own schema and needs no change: `ZFindResultResponse` (`packages/lib/types/search-params.ts:41-47`) declares the flat `{ data, count, currentPage, perPage, totalPages }`, `ZFindEnvelopesResponseSchema` extends it and is wired as the route's `.output()`, and that same schema feeds the generated OpenAPI reference the guides point readers at. The strings `pagination` and `totalItems` appear nowhere under `packages/` or `apps/` except `apps/docs/content`. So this is a docs-only fix and this PR is the whole of it for the getting-started page.

Two practical notes.

**This PR needs a rebase.** Its base branch was `docs/fields-envelope-schema` and its siblings #3133, #3134 and #3135 merged into `main` this morning, so `mergeable_state` is now `dirty`. It has also never had a maintainer review. `first-api-call.mdx` itself has had no commit since v2.16.0, so the hunk should still apply cleanly once the base moves to `main`.

**The finding is now bigger than this PR, and smaller than it was.** #3135 fixed the `documents.mdx` half on 2026-08-19 (flat counters in both the response example and the "fetch all pending documents" loop), and that is in v2.17.0. What is left, verified by `git grep -n 'pagination\|totalItems' apps/docs/content` on `origin/main` at `75330166cc`, is five hits in four files:

- `apps/docs/content/docs/developers/getting-started/first-api-call.mdx` L81-L86, this PR. Still live on the published site today: https://github.com/documenso/documenso/blob/75330166cc00b29c14399bc2e391e4b4d8080c00/apps/docs/content/docs/developers/getting-started/first-api-call.mdx#L81-L86 renders as

```json
"pagination": { "page": 1, "perPage": 10, "totalPages": 1, "totalItems": 1 }
```

- `apps/docs/content/docs/developers/api/templates.mdx` L142-L143 and L184-L188, and `apps/docs/content/docs/developers/api/teams.mdx` L177-L178 and L344-L345, both covered by #3138.
- `apps/docs/content/docs/developers/examples/common-workflows.mdx` L894 and L908, covered by #3139.

If it would be easier to review the leftovers as one item rather than as three stacked PRs, an issue tracking the four remaining pages would work equally well; the rename map above is the entire change.

Found by TrueCourse running the published API docs against a live instance; the full transcript (requests, responses, server log) is available on request.
