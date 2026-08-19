# D14 live re-verification

**List responses are documented with `pagination: {page, perPage, totalPages, totalItems}`; the counters are flat.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0**.
- Instance: port 3347, database `tc_reverify_documenso`. Auth `Authorization: <owner api token>`, redacted.

## Verdict

**still reproduces**, with the scope reduced by one page. The bound page named in the review, `documents.mdx`, was corrected by PR #3135 and that fix is in the build under test. `first-api-call.mdx` still publishes the fabricated wrapper, so the finding survives on the getting-started page.

## The wire

`GET /api/v2/envelope` -> **200**. Top-level keys (`shape.json`):

```json
["data","count","currentPage","perPage","totalPages"]
```

- `pagination` object present: **false**
- flat counters observed: `count: 1`, `currentPage: 1`, `perPage: 10`, `totalPages: 1`

None of `pagination.page`, `pagination.perPage`, `pagination.totalPages` or `pagination.totalItems` exists. Raw capture: `step-1.request.json`, `step-1.response.json`.

The rename map, confirmed on the wire: `page` -> `currentPage`, `totalItems` -> `count`; `perPage` and `totalPages` keep their names and only lose the nesting level.

## The documentation in the build under test

- `apps/docs/content/docs/developers/api/documents.mdx`: the response example now shows `"currentPage": 1` (line 248) and the paging loop now destructures `const { data, currentPage, totalPages } = await response.json();` (lines 944 to 947). **Fixed.**
- `apps/docs/content/docs/developers/getting-started/first-api-call.mdx`, lines 81 to 86, still publishes:
  ```json
  "pagination": {
    "page": 1,
    "perPage": 10,
    "totalPages": 1,
    "totalItems": 1
  }
  ```
  **Not fixed.** A developer following Example 1 of the getting-started page destructures a key that does not exist.

## Comparison with the original transcript

The original run (v2.16.0) failed at its step 1 with `expected: json pagination.page to exist / actual: json pagination.page missing`, against the same flat response shape. The product side is unchanged and remains correct against its own schema; the live run reproduces the mismatch exactly.

## What this changes for the finding

- The finding must no longer be described as "documents.mdx is wrong". That half shipped in v2.17.0.
- What remains is `first-api-call.mdx` (#3137), `templates.mdx` and `teams.mdx` (#3138), and `common-workflows.mdx` (#3139), all still open.
- Because the bound page for the scenario was `documents.mdx`, the scenario itself would no longer be red against the doc it is bound to; it stays red against the product only if re-bound to the getting-started page. That is a scope narrowing, not a verdict change.
