# FP-Audit Pipeline — Design

A reproducible, scriptable workflow for auditing false positives across target
repos and fixing them with proper fixture coverage.

## Goals

- Single command per stage; stages are rerunnable.
- Every classified FP gets a **positive fixture** (must NOT trigger the rule
  after the fix) and the rule keeps a **negative fixture** (must STILL trigger
  on the genuine antipattern).
- `fp.jsonl` is the source of truth — every entry has a `status` field that
  is updated automatically by post-commit hooks.
- A CI gate prevents regressions: surviving FP count cannot increase, and no
  negative fixture can stop firing.

## Pipeline (9 stages)

```
1. clone        target repo → /tmp/audit-targets/<repo>
2. analyze      truecourse → LATEST.json
3. slice        cluster violations by (rule, shape-signature) → N slices
4. classify     M agents in parallel → per-slice {TP|FP|DRIFT|UNCERTAIN}
5. aggregate    merge per-slice → fp.jsonl (status: "unconfirmed")
6. fixturize    per FP → positive fixture; per rule → negative fixture
7. fix          human/agent edits the rule visitor
8. track        post-commit hook → update fp.jsonl status
9. validate     CI gate → all positive fixtures must show fix; all negatives
                must still fire; surviving count monotonic
```

Stages 1–5 produce the audit. Stages 6 and onward are the fix loop.

## File layout

```
tools/fp-audit/
├── 01-analyze.sh             # clone + analyze
├── 02-slice.mjs              # cluster violations
├── 03-classify-agent.mjs     # Claude API call per slice
├── 04-aggregate.mjs          # → fp.jsonl
├── 05-fixturize-agent.mjs    # per FP, generate fixture
├── 06-update-status.mjs      # diff fp.jsonl ↔ LATEST.json
├── 07-validate.mjs           # CI gate
└── README.md                 # ops doc

audit-state/<repo>-<commit>/
├── LATEST.json               # snapshot at audit time
├── slices/                   # per-slice input
│   └── slice-NN.jsonl
├── reports/                  # per-slice agent output
│   └── slice-NN.jsonl
├── fp.jsonl                  # aggregated, status-tracked
├── fixtures/
│   ├── positive/<rule>/<shape-id>.<ext>
│   └── negative/<rule>/<shape-id>.<ext>
└── state.json                # last analyze hash, last commit hash, etc.
```

The audit state is per `(repo, commit)` so re-running on a different commit
doesn't trash a prior audit.

---

## Stage details

### 1. analyze (`01-analyze.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO_URL=$1; BRANCH=${2:-main}
TARGET=/tmp/audit-targets/$(basename "$REPO_URL" .git)

[[ -d $TARGET ]] || git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$TARGET"
cd "$TARGET"
truecourse analyze --no-llm --no-stash

mkdir -p audit-state/$(basename "$TARGET")-$(git rev-parse --short HEAD)
cp .truecourse/LATEST.json audit-state/.../LATEST.json
```

### 2. slice (`02-slice.mjs`)

Groups violations by `(rule, shapeSignature)` where the signature is a
normalized hash of the surrounding 5 lines (strip whitespace, replace
identifiers with `_`, replace string literals with `""`, replace numbers with
`0`). Aim for ≤100 violations per slice.

```ts
function shapeSig(file, line) {
  const ctx = readLines(file, line - 2, line + 3)
  return sha1(ctx.replace(/[a-zA-Z_$][\w$]*/g, '_')
                 .replace(/(['"`])[^'"`]*\1/g, '""')
                 .replace(/\d+/g, '0'))
}
```

Output: `slices/slice-NN.jsonl` (one violation per line, with `shapeSig`).

### 3. classify (`03-classify-agent.mjs`)

For each slice, spawn a Claude agent with a strict prompt:

> You are reviewing N violations, each with the same (rule, shape signature).
> For each one, classify as `TP`, `FP`, `DRIFT`, or `UNCERTAIN`. Output ONLY
> JSONL with this schema:
> `{file, line, rule, class, shape, why, skip_hint}`

Run agents in parallel via a queue (`p-limit` or `xargs -P 8`).
Per-slice cost is bounded; classify each slice in a single agent call.

Cheap pre-classifier idea: rule-name regex can mark "obvious TP" (e.g.,
hardcoded password matches `password.*=.*['"]\w+['"]`). Skip those.

### 4. aggregate (`04-aggregate.mjs`)

Merge `reports/slice-NN.jsonl` → `fp.jsonl`. Add `status: "unconfirmed"`.
Drop duplicates on `(file, line, rule)`.

### 5. fixturize (`05-fixturize-agent.mjs`)

**The hard step.** Per FP entry, run an agent with this contract:

```
Input:
  - target file path + ±15 lines around the FP line
  - rule key, shape, why
Required output:
  - A self-contained fixture file (same language) that:
    a) preserves the AST shape that triggers the rule
    b) declares external symbols as `declare const` / `declare type` (TS)
       or stub-class / typing.Annotated (Py)
    c) contains no project-specific imports
  - The fixture, when fed to truecourse analyze, MUST trigger the audit's rule
Verification loop (max 3 iterations):
  generate → analyze fixture → expect violation → if not, feed analyzer
  output back to agent → retry
```

Output:
- `fixtures/positive/<rule>/<shape-id>.<ext>` — the FP shape (must NOT fire
  after fix)
- `fixtures/negative/<rule>/<shape-id>.<ext>` — extracted from a TP for the
  same rule (must STILL fire after fix)

Per-rule negatives are built once from the audit's TP entries. One negative
per rule is the cheap default; per (rule, shape) is more thorough.

If verification fails after 3 retries, mark the entry
`status: "fixture-failed"` and write a reason to a queue file
(`fixtures-failed.jsonl`) for human review. Don't block the pipeline.

### 6. update-status (`06-update-status.mjs`)

Diff `fp.jsonl` against current `LATEST.json` for each target:

```ts
for (const entry of fp) {
  const key = `${entry.file}:${entry.line}:${entry.rule}`
  const stillFiring = currentViolations.has(key)
  entry.status = stillFiring ? 'surviving' : 'fixed'
  if (!stillFiring && !entry.fixed_by_commit) {
    entry.fixed_by_commit = currentGitSha()
  }
}
writeJsonl('fp.jsonl', fp)
```

Wire this as a post-commit hook in the analyzer repo:
```bash
# .git/hooks/post-commit
bash tools/fp-audit/track.sh
```

`track.sh` runs analyze on each target, then updates `fp.jsonl`. Cheap if
`truecourse analyze` is fast (typically <10s for cached runs).

### 7. validate (`07-validate.mjs`) — CI gate

Two contracts, one script per:

**Positive contract:** every fixture in `fixtures/positive/<rule>/` is run
through the analyzer. Expectation: zero violations of `<rule>`. If any,
fixture is "still firing" — fix isn't complete.

**Negative contract:** every fixture in `fixtures/negative/<rule>/` is run
through the analyzer. Expectation: at least one violation of `<rule>`. If
none, fix was too aggressive — over-suppressed.

**Monotonic contract:** read `fp.jsonl` from previous commit (via
`git show HEAD~1:audit-state/.../fp.jsonl`). Surviving count cannot increase.

Exit code 0 if all pass; non-zero (with diff) otherwise.

---

## Tracking key — fragile vs robust

`(file, line, rule)` is fragile: when the target repo gets new commits, lines
shift and the key changes. Two ways to handle:

1. **Pin the audit to a specific target commit.** `state.json` stores
   `target_commit_sha`. When tracking, always check out that SHA before
   running analyzer. Pro: stable keys. Con: never benefits from upstream
   fixes in the target repo.
2. **Content-hash the surrounding code.** Use the same `shapeSig` from stage
   2. When tracking, find the violation by `(file_basename, rule, shapeSig)`.
   More robust to line shifts but costs more to compute and may collide.

Recommend (1) for the first version. Keep audit state immutable; create a new
audit when you want fresh target state.

---

## Cost / performance notes

- 39-slice audit on documenso+OpenHands took ~60-90 min wall clock with 10
  parallel agents. Cost was on the order of $20-50.
- Fixturize is more expensive — each FP needs an agent loop. Budget ~$0.10-
  0.50 per FP. For 2,800 FPs, that's $300-1,500. Run in batches; cache by
  `(rule, shapeSig)` so fixtures are reused for similar shapes.
- Status tracking is essentially free — just a diff.

Practical staging:
- Audit + classify: run on every new target.
- Fixturize: run only for FPs, in batches. Skip shapes already covered by
  another FP's fixture (dedupe by `shapeSig`).
- Validate: every commit (fast, ~30s).

---

## Open design questions

1. **Agent runtime** — Anthropic API direct, or Claude Code subagents? API
   is cheaper and parallelizable; subagents have file-system tools needed
   for fixturize verification. Recommend API for stages 3-4 (classify) and
   subagents for stage 6 (fixturize).
2. **Fixture location** — separate per-target dir, or auto-PR into the
   analyzer's `tests/fixtures/`? PR'd integrates with existing test runner;
   per-target keeps audit state self-contained. Recommend per-target dir
   with a `--promote` flag that copies confirmed fixtures into the analyzer
   tests.
3. **Negative-fixture granularity** — one per rule (cheap, may miss shape
   variants) or one per (rule, shape) (thorough, ~10x fixture count).
   Recommend one-per-rule baseline + opt-in per-shape for high-FP rules.
4. **What to do on fixturize failure** — auto-skip + log, queue for human,
   or block. Recommend auto-skip + log; humans review the failure queue.
5. **How to enforce "don't fix without fixtures"** — pre-commit hook that
   fails if `fp.jsonl` shows status: "surviving" → "fixed" without a
   matching fixture in `fixtures/positive/<rule>/`. Strict but prevents the
   "I forgot to write a fixture" failure mode.

---

## What this prevents (vs the previous run)

- **Untracked fixes.** Status field on every entry, updated automatically.
  Always answers "what's left" with a single `jq` query.
- **Over-suppression.** Negative fixtures fail CI if a fix kills a TP shape.
- **Shape-skip drift.** Each FP entry has its own positive fixture; if the
  rule's skip pattern stops matching that shape, the fixture stops passing
  and CI fails.
- **Per-instance vs per-rule confusion.** Status is per-FP-instance.
  "Fixed" means that specific entry's `(file, line, rule)` no longer
  produces a violation — not "the rule has a skip somewhere that catches
  similar shapes."

---

## First milestone

Build stages 1-5 + 8 (audit + status tracking). That gives:
- A reproducible audit per target
- A live `surviving` count

Build stages 6 + 9 next. Defer stage 7 — fixing is the slow human/agent loop
and benefits most from having the other infra in place.
