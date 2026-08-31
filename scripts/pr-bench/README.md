# PR bench

Evaluates whether a PR introduced a bug by running the guard pipeline at the
PR's merge-base and at its head, then diffing per-scenario verdicts. The target
repo never carries `.truecourse/` — everything lives in a bench root you choose.

## How it decides

The corpus is generated **at each commit** (never frozen at base): a PR that
changes a spec re-authors exactly the affected scenarios, so partial
implementations of new spec obligations are caught. The head generation is
seeded from the base's generated corpus, so every scenario difference between
the two is PR-caused. Scenarios partition by id + content hash:

| partition | meaning | signal |
|---|---|---|
| unchanged | same bytes in both corpora | base green → head red = **regression** |
| changed | same id, re-authored by the PR | head red = **changed obligation not met** |
| added | head-only | head red = **new obligation not met** |
| removed | base-only | reported as a **dropped obligation** |

Determinism for the unchanged partition comes from the product, not the bench:
the shared `.cache/` LLM caches are content-keyed and `scenarios/manifest.json`
makes an unchanged flow a generate no-op, so untouched scenarios carry over
byte-identical.

Outcomes are memoized in a per-commit **ledger** keyed by scenario content hash
(`ledger/<sha>.json`), so a merge-base shared by several PRs runs each scenario
once, and a later PR branched from an already-evaluated commit pays nothing for
its base.

## Bench root layout

```
bench.json          repo, mainBranch, truecourse argv prefix
repo/               clone of the target
wt-base/ wt-head/   persistent worktrees (checked out per job)
seedstore/          the rolling overlay: the committable half of .truecourse
                    (specs/, scenarios/, contracts/, interfaces.authored.json,
                    config.json) + scenarios/externals.local.json secrets
cache/              ONE shared .truecourse/.cache, symlinked into both worktrees
ledger/<sha>.json   memoized per-scenario outcomes
corpora/<sha>.json  scenario id → content hash per generated corpus
reports/            eval reports (markdown)
```

## Workflow

All commands run from the TrueCourse repo root via `pnpm tsx scripts/pr-bench/pr-bench.mts …`.

```bash
# 1. One-time init (LLM transport must already be configured: truecourse config llm setup)
pr-bench init ~/bench/acme --repo git@github.com:acme/acme.git \
  --truecourse "node /path/to/truecourse/tools/cli/dist/index.js"

# 2. Bootstrap: author the corpus once on main (the expensive run), then review
#    the worktree store (spec conflicts, dismissals, authored web tasks) and
#    drop external-API secrets into seedstore/scenarios/externals.local.json.
pr-bench run-commit ~/bench/acme origin/main
pr-bench promote ~/bench/acme

# 3. Evaluate PRs (exit code 2 when regressions or unmet obligations exist)
pr-bench eval ~/bench/acme --pr 1234              # merge-base vs PR head
pr-bench eval ~/bench/acme --pr 1234 --merge-ref  # …vs the speculative merge
pr-bench eval ~/bench/acme --head my-branch       # non-PR ref; base = merge-base vs main

# 4. After a PR merges, roll the baseline forward from the merged commit
pr-bench run-commit ~/bench/acme origin/main && pr-bench promote ~/bench/acme
```

`promote` refuses a commit that is not on `origin/<mainBranch>` — promoting a
PR-side corpus would poison every later baseline (same rule as committing
`LATEST.json` only from main).

## Caveats

- Base and head run **serially** in the same environment; the recipe boots the
  live app, so parallel runs would collide on ports and databases.
- Evidence links in reports point into `wt-head/.truecourse/guard/evidence/`,
  which is wiped on the next materialization of that worktree — read them
  before re-running.
- Verdict flips still need triage: a red can be a flake or an LLM-misread spec,
  not a code bug. `changed`-partition noise (a spec edit re-authoring an area's
  untouched neighbors) is a known limitation until scenario identity is
  claim-level.
- Partial memoized runs loop `guard run --scenario <id>` one boot per scenario;
  when at least half the corpus is unrun the whole board runs in one boot
  instead.
