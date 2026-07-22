# Findings summary — 14 repositories

Guard pipeline (spec scan → scenario generation → run) executed against 14 open-source
CLI repositories, 2026-07-15 → 2026-07-18. Every finding below was hand-verified against
the live tool before being counted; candidates attributed to test-generation mistakes are
excluded everywhere (they are disclosed per-repo). Each repo's numbers come from its own
document in this directory.

## Verified findings and tracker overlap

| Repo | Verified findings | Kind | Exact match | Related | Unreported | Unknown |
|---|--:|---|--:|--:|--:|--:|
| sqlfluff | 11 | 8 doc bugs · 2 parser gaps · 1 minor | 1 | 2 | 8 | — |
| datamodel-code-generator | 8 | doc-vs-doc contradictions | — | — | — | 8 |
| isort | 4 | doc bugs (incl. a documented feature that no longer exists) | 0 | 0 | 4 | — |
| node-semver | 2 | doc bugs (stale help block) | 0 | 2 | 0 | — |
| commitlint | 2 | 1 doc bug · 1 doc-vs-doc contradiction | 0 | 1 | 1 | — |
| black | 2 | doc bugs (preview-style examples) | 0 | 0 | 2 | — |
| httpie | 1 | code bug (`--form` accepts Booleans the manual forbids) | 0 | 0 | 1 | — |
| mustache.js | 1 | source-tree defect (CLI crashes on Node ≥ 22; shipped package unaffected) | 0 | 1 | 0 | — |
| marked | 0 | — | — | — | — | — |
| markdown-it-py | 0 | — | — | — | — | — |
| json5 | 0 | — | — | — | — | — |
| editorconfig-core-js | 0 | — | — | — | — | — |
| yamllint | — | not analyzable (rst-only docs; tool limitation #806) | — | — | — | — |
| stylelint, prettier | — | not run (stopped by decision) | — | — | — | — |

**Totals: 31 verified findings.** Tracker classification where cross-checked (23 findings):
**1 exact** (sqlfluff's `fix`-output drift — reported in #6968, fixed by merged PR #7353 in
the legacy docs only; the current docs still carry it), **6 related** (shared root or
feature area with tracked work, e.g. node-semver's help block re-drifting after a 2016 fix
and surviving a Jan 2026 docs PR), **16 unreported**. The 8 datamodel-code-generator
contradictions were not tracker-checked.

By kind: 21 documentation-vs-behavior bugs, 9 documentation-vs-documentation
contradictions (8 dcg + 1 commitlint), 1 code bug (httpie), 1 source-tree defect
(mustache.js). Note the httpie entry is the single case where the documentation is right
and the code is wrong (`bool` passing an `isinstance(…, int)` gate in
`requestitems.py:181`).

## Run statistics

| Repo | Scenarios committed | Run result | Cost of final complete run |
|---|--:|---|--:|
| sqlfluff | 169 | 169 pass | $25.25 |
| commitlint | 74 | 74 pass | $24.80 |
| isort | 71 | 71 pass | $20.86 |
| black | 51 | 51 pass | $19.66 |
| node-semver | 49 | 49 pass | $12.70 |
| httpie | 49 | 49 pass | $65.69 |
| json5 | 21 | 21 pass | $4.87 |
| marked | 19 | 19 pass | $1.53 |
| markdown-it-py | 8 | 8 pass | $1.80 |
| editorconfig-core-js | 2 | 2 pass | $0.97 |
| mustache.js | 0 | nothing runnable | $2.69 |
| datamodel-code-generator | 0 | generation stopped (usage limits; 960-section corpus, est. ceiling $620) | $95.15 spent |

513 committed scenarios, all passing at their final `guard run`. Costs are the final
complete run per repo; sqlfluff had three earlier runs during engine development
($22.08, $49.89, $64.07) and dcg one earlier truncated attempt. Total spend across the
campaign including repeats: ≈ $420.

## Tool defects found by the campaign (fixed or filed)

Running against real repos surfaced 5 engine defects, each fixed in its own commit and
released before continuing (v0.7.3-next.6 → next.10): frozen-lockfile installs proposed
for lockfile-less repos + no revision loop on verification failure (node-semver);
scenario filenames unbounded by heading length (marked); monorepo workspace manifests
invisible to recipe discovery (commitlint); no license to drop a failed install for
dependency-free CLIs (mustache.js); corpus pack data files parsed as scenarios when the
pack subject is itself YAML (datamodel-code-generator). Filed, not yet fixed: #806
(rst-format docs unsupported), #807 (empty corpus reports as success), #810 (nonzero
`claude` exits discard the child's own error output — this obscured both usage-limit
truncations), #805 (wall-clock timeouts kill healthy slow calls; two more occurrences
observed). One automated-triage misjudgment is on record (commitlint: real drift judged
"environment"); its below-high confidence kept it routed to a human, so nothing was
auto-dismissed incorrectly.
