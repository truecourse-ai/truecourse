# Eval candidates

How to pick repos for `tests/eval/repo.test.ts`. The framework verifies
**code against a prose contract spec**, so a useful target needs both:

1. A TypeScript / JavaScript HTTP service (the verifier's code-side
   extractors target Express-style routing).
2. A **prose contract spec inside the same repo** — typically a
   `SPEC.md` / `API.md` / `CONTRACT.md` describing endpoints, entities,
   business rules. README install instructions don't count. OpenAPI
   YAML doesn't count either — the framework reads markdown prose, not
   structured machine specs.

If a repo doesn't have an in-repo prose spec, we skip it. There is no
value in eval-ing the framework against half its inputs.

## What we learned trying Tier 1 / Tier 2 OSS candidates

| Repo                                            | Result                                                |
|-------------------------------------------------|-------------------------------------------------------|
| `gothinkster/node-express-realworld-example-app`| ✓ Worked after manually pulling the spec from upstream `gothinkster/realworld`. 0 drifts on the final run. |
| `tabler/tabler-api`                             | ✗ Repository doesn't exist.                           |
| `cypress-io/cypress-realworld-app`              | ✗ README is install instructions only.                |
| `directus/directus`                             | ✗ Docs moved out of the monorepo.                     |
| `payloadcms/payload`                            | ✗ Docs are external; in-repo markdown is changesets.  |

The pattern: most OSS APIs ship an OpenAPI document or external docs
site, not in-repo markdown prose. Real value for the framework comes
from **internal projects** where the team writes contractual prose
alongside the code.

## Where to look next

Better odds of finding a usable target:

- **Your own private services** with a hand-written API.md / SPEC.md.
  Point the harness at the local path; it'll copy into
  `tests/.eval-repos/` so the original isn't touched.
- **Repos using a "spec-first" workflow** like Stoplight Studio's
  output, or Smartbear's projects — they sometimes export prose
  alongside the YAML.
- **University / textbook projects** that ship a written API
  specification as part of the assignment.
- **Internal company docs** for any team running this — the framework
  is most useful where *humans wrote prose for humans*, then asked for
  it to be machine-verified.

If you find a candidate, just point at it:

```bash
# Git URL — clones into tests/.eval-repos/<slug>/
EVAL_TARGET=https://github.com/foo/bar pnpm vitest run tests/eval/repo.test.ts

# Local path — copies into tests/.eval-repos/<slug>-local/
EVAL_TARGET=~/code/my-service pnpm vitest run tests/eval/repo.test.ts

# First-time scoping run — cap LLM calls at 10:
EVAL_TARGET=<...> EVAL_MAX_SLICES=10 pnpm vitest run tests/eval/repo.test.ts

# Verify-only (no extraction) — assumes contracts already exist:
EVAL_TARGET=<...> EVAL_NO_LLM=1 pnpm vitest run tests/eval/repo.test.ts

# Diff produced .tc against a known-good corpus:
EVAL_TARGET=<...> EVAL_GOLDEN=tests/fixtures/sample-js-project-il/.truecourse/contracts \
  pnpm vitest run tests/eval/repo.test.ts
```

Reports land in `tests/.eval-reports/<slug>.md` (gitignored). Cloned
repos cache under `tests/.eval-repos/<slug>/`.
