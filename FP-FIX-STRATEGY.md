# False-Positive Fix Strategy

This document is the source of truth for **how** false-positive fix work is done on TrueCourse, regardless of which target repo we're analyzing. Every time we adopt a new target repo for FP analysis, we follow the same two-phase protocol below.

## Phase 1 — Comprehensive FP analysis (BEFORE any fix work)

We do not fix anything until we have classified every rule that fires on the target. Sampling 4 of each rule is not enough; the queue must be derived from a full pass over the analysis output.

For each target repo:

1. **Run the analyzer, dump every violation to disk.** `truecourse analyze --no-llm --no-skills --no-stash` against a fresh shallow clone. The full output lives in `<repo>/.truecourse/LATEST.json`.
2. **Group every violation by `ruleKey`.** Produce a per-rule frequency table covering ALL severity tiers — critical, high, medium, low. Medium and low tier are not skipped just because they're noisy; they're where the long-tail FPs hide.
3. **Classify every rule** as TP / FP / mixed:
   - Rules with ≤10 findings: read every finding, classify each.
   - Rules with 11–100 findings: read every finding, group by file-path or snippet shape, classify each shape.
   - Rules with >100 findings: group by shape first (cluster file-path patterns, snippet prefixes, surrounding-AST patterns), then classify each shape. Confirm the rule's classification covers all observed shapes — do not declare a rule "fully classified" after looking at one cluster.
4. **Write the FP analysis to `FP-ANALYSIS-<target>.md`** alongside this strategy doc. One row per rule, columns: rule key, total firings, classification (TP / FP / mixed), notes per FP shape, file:line references for the worst examples.
5. **Build the fix queue** at the end of the analysis doc, ordered by FP volume (biggest noise reduction first). The queue is the ONLY input to Phase 2.

**Do not start fixing until the analysis doc is complete for the target.** Every shortcut in Phase 1 produces a partial fix queue, which leaves work that "feels done" but isn't.

## Phase 2 — The non-negotiable fix cycle

For every rule fix, in order:

1. **Add a positive fixture case.** A realistic snippet of the FP shape, embedded in `tests/fixtures/sample-{js,python}-project-positive/` under one of the existing services (`api-gateway`, `user-service`, `notification-service`, `web`, `infrastructure`). No `// VIOLATION:` comment — the positive fixture is asserted to produce **zero** violations.
2. **Add a corresponding negative case.** A realistic snippet that *should* fire, in `tests/fixtures/sample-{js,python}-project-negative/`, marked with `// VIOLATION: <rule-key>` (Python: `# VIOLATION: <rule-key>`) on the line **above** the violating code.
3. **Run tests and confirm they fail.** `pnpm test 2>&1 | tee /tmp/test-output.txt` and read the file. The positive test must report the FP we just added; the negative test must continue to fire on the new marker. If the positive test already passes, the fixture isn't representative — go back to step 1 with a closer match to the real-world FP.
4. **Fix the rule.** Edit only the analyzer code that produces the FP. No surrounding cleanup, no helper extraction, no scope creep.
5. **Re-run the full test suite. It must be fully green.** Not just the positive and negative fixture tests — every test in the suite. If any test is red, it is part of this cycle and must be fixed before the cycle is done. There is no such thing as a "pre-existing" or "unrelated" red test once you've started a cycle. If a graph snapshot drifts because you added files, update the snapshot. If anything else broke, root-cause and fix it. Red tests mean the work is not done.
6. **Commit.** One rule per commit. Commit message names the rule key and FP class (`fix(rule:hardcoded-secret): ignore identifier-like values (snake_case/kebab-case)`).

**Rules:**
- Never edit the rule before the fixture. Fixtures-first is the only ordering that proves the fix actually addressed the case we observed.
- Never weaken a rule by removing detections from the negative fixture. If a negative case has to be removed, that's a scope decision the user needs to confirm.
- Fixtures must use **realistic** code shapes, not synthetic toy snippets. Source the shape from the actual FP in documenso/OpenHands (the report has file:line refs).
- One rule per commit so each fix is bisectable.
- **Full green or not done.** Never use phrases like "pre-existing failure", "unrelated to my changes", or "out of scope" to defer a red test. Investigate, root-cause, fix. The only signal that work is complete is full green.

## Test commands

```bash
# All tests, save full output (per CLAUDE.md "no repeated grep" rule)
pnpm test 2>&1 | tee /tmp/test-output.txt

# Just the positive-fixture suite (fast iteration during a fix)
pnpm test tests/analyzer/js-positive.test.ts 2>&1 | tee /tmp/test-output.txt
pnpm test tests/analyzer/python-positive.test.ts 2>&1 | tee /tmp/test-output.txt

# Just the negative-fixture suite
pnpm test tests/analyzer/js-negative.test.ts 2>&1 | tee /tmp/test-output.txt
pnpm test tests/analyzer/python-negative.test.ts 2>&1 | tee /tmp/test-output.txt

# Rule-specific unit tests (e.g. secret-scanning)
pnpm test tests/analyzer/secret-scanning.test.ts 2>&1 | tee /tmp/test-output.txt
```

## Fixture conventions (verified by reading the test runners)

- **Positive fixture root**: `tests/fixtures/sample-{js,python}-project-positive/`. Test runner walks recursively and asserts `violations.length === 0`. Any code added here must not trigger any rule.
- **Negative fixture root**: `tests/fixtures/sample-{js,python}-project-negative/`. Test runner parses `// VIOLATION: <rule-key>` comments (`# VIOLATION:` for Python). Each marker MUST match a violation on the next line, and unexpected violations fail the test.
- **Service layout**: both fixtures use the same multi-service shape (`api-gateway`, `user-service`, `notification-service`, `web`, `infrastructure`). Match new code to the service whose role best fits (e.g. auth/identity → `user-service`, public API gateway → `api-gateway`, frontend → `web`).
- **Realism**: per `CLAUDE.md` and memory, fixtures must look like production code. Take the actual snippet from the documenso/OpenHands FP that motivated the fix and lift it into the fixture nearly verbatim, with naming adapted to the service.

## Fix queue

The fix queue is defined per-target in `FP-ANALYSIS-<target>.md`, derived from the Phase 1 analysis. Order it by FP volume (biggest noise reduction first). Do not maintain a fix queue here — this doc is just the protocol; the queue lives next to the analysis it came from.

## Phase 3 — Verification after every fix queue is exhausted

Re-run the analyzer on every target whose FP analysis fed the queue. Compare counts at every severity tier (not just critical). Update `FP-ANALYSIS-<target>.md` with post-fix numbers and a TP/FP breakdown of what's left.

Done = every rule that still fires has been confirmed as a true positive on every remaining finding (or the count is 0). "0 critical, low residual high" is not enough; if medium tier still has known FPs, the queue isn't exhausted.

```bash
# Example invocation against the cached clones
cd /tmp/tc-targets/<repo> && rm -rf .truecourse && \
  node <worktree>/tools/cli/dist/index.js analyze --no-llm --no-skills --no-stash
```

## What not to do

- Do not add a "skip" / "exclude" config option as a fix when the rule logic itself is wrong. The fix has to be in the rule.
- Do not turn off rules. Rule-level disables hide problems; we want them tightened, not silenced.
- Do not refactor adjacent code. Bug-fix-shaped commits only.
- Do not add comments explaining the fix. The commit message + the fixture pair are the documentation.
