# Eval candidates

Suggested open-source repos for testing the contract framework with
`scripts/eval-on-repo.ts`. Picked for: TS/JS, HTTP service, prose docs,
manageable size on the first run.

## Tier 1 — small, tractable

Start here. Each should produce a meaningful report on first run with
a bounded LLM cost.

### `gothinkster/node-express-realworld-example-app`
- URL: <https://github.com/gothinkster/node-express-realworld-example-app>
- Why: Express + JS, the README ships a structured API spec
  (auth, articles, comments, profiles, tags) with concrete request /
  response shapes. Closest in spirit to our planted-bug fixture.
- Risk: README is the only spec — slicer will produce one input file.
- Expected cost: ~10–15 LLM calls.

### `tabler/tabler-api`
- URL: <https://github.com/tabler/tabler-api>
- Why: TS, REST API for the Tabler dashboard, has docs and a clean
  controller layout.
- Risk: docs may be on the website rather than in the repo.

### `cypress-io/cypress-realworld-app`
- URL: <https://github.com/cypress-io/cypress-realworld-app>
- Why: TS Express + React, has business rules described in the README
  (transfers, contacts, notifications).
- Risk: monorepo-shaped; the harness's auto-detect picks one of `src/`
  / `app/` — may need explicit `codeDir`.

## Tier 2 — bigger, structured docs

Run after Tier 1 reports confirm the harness works. These have real
documentation but extraction will cost more.

### `payloadcms/payload`
- URL: <https://github.com/payloadcms/payload>
- Why: TS-first headless CMS with `/docs` directory full of structured
  markdown.
- Risk: ~hundreds of slices → real money. Use `--max-slices 20` first.

### `directus/directus`
- URL: <https://github.com/directus/directus>
- Why: TS, REST + GraphQL, clean OpenAPI spec.
- Risk: large monorepo.

## Tier 3 — local services

If you have a private service with a SPEC.md handy, that's the best
benchmark — feed the harness an absolute path:

```bash
pnpm tsx scripts/eval-on-repo.ts ~/code/my-service
```

## Workflow

The harness is a vitest test gated by `EVAL_TARGET`. It runs only when
that env var is set — no risk of accidentally invoking it during a
normal test run.

```bash
# First run (cost: one LLM call per slice):
EVAL_TARGET=<url-or-path> pnpm vitest run tests/eval/repo.test.ts

# Skip extraction; just verify what's already there:
EVAL_TARGET=<url-or-path> EVAL_NO_LLM=1 \
  pnpm vitest run tests/eval/repo.test.ts

# Cap LLM calls when scoping a new repo:
EVAL_TARGET=<url-or-path> EVAL_MAX_SLICES=5 \
  pnpm vitest run tests/eval/repo.test.ts

# Compare against a known-good corpus (e.g. our fixture):
EVAL_TARGET=<url-or-path> \
EVAL_GOLDEN=tests/fixtures/sample-js-project-il/.truecourse/contracts \
  pnpm vitest run tests/eval/repo.test.ts
```

Reports land in `tests/.eval-reports/<slug>.md` (gitignored).
Cloned repos cache under `tests/.eval-repos/<slug>/`.
