# False-Positive Fix Strategy

This document is the source of truth for **how** false-positive fix work is done on TrueCourse, regardless of which target repo we're analyzing. Every time we adopt a new target repo for FP analysis, we follow the same four-phase protocol below.

The protocol has been validated across documenso 0.5.7 + OpenHands 0.5.7 (commits FP #1 → #26+) and refined by what we learned about its failure modes — see "Lessons learned" at the end.

## Phase 0 — Check known FP shapes against the new target

The 26+ FP classes already fixed in this branch are catalogued in the commit log (`git log --grep "fix(rule:" --oneline`). Each commit names the rule key and the FP shape. When picking up a NEW target:

1. Run analyze on the target with the latest local build (not v0.5.7 — that's pre-fixes).
2. The known FP shapes are already exempted by the rule — they won't fire. Anything that DOES fire from those rule-keys is either a NEW FP shape we haven't seen, or a true positive.
3. Do NOT re-litigate fixed FP classes. If you find a new shape under an already-fixed rule, treat it as a new FP cycle (Phase 2) but reuse the existing fixture file when possible.

**Skip Phase 1 work entirely for rules already on the known-style list (below).** Those are TPs by definition — confirmed firing-correctly across multiple targets — and reclassifying them wastes agent budget.

## Phase 1 — Comprehensive FP analysis (parallel agents)

We do not fix anything until every rule firing on the target has been classified. Sampling 4 of each rule by hand is not enough — the queue must come from a full rule-by-rule pass with ≥8 samples per rule plus source-code context.

The reliable way to do this is to spawn parallel sub-agents, one per chunk of rules, each with fresh context.

### Step 1: Run analyze + dump per-rule samples

```bash
cd /tmp/tc-targets/<target> && rm -rf .truecourse && \
  node <worktree>/tools/cli/dist/index.js analyze --no-llm --no-skills --no-stash
```

Then write per-chunk sample files (high-volume / mid-volume / low-volume buckets per target):

```js
// Inline node script — see git history for the canonical version
// reads <target>/.truecourse/LATEST.json, groups by ruleKey,
// drops rules in the known-style skip list,
// writes /tmp/fp-chunk-<target>-{high,mid,low}.txt with up to 8 samples each.
```

Bucket thresholds: HIGH ≥30 findings, MID 5–29, LOW <5. Each chunk file has all rules in that bucket with up to 8 samples per rule (`file:line` + 200-char snippet).

### Step 2: Spawn parallel classification agents

One agent per chunk. With 2 targets × 3 buckets = 6 agents. Prompt template:

```
You are classifying TrueCourse analyzer rules to find false positives.

CONTEXT:
- TrueCourse is a static analyzer for TS/JS/Python.
- A "false positive" (FP) means the rule's semantic claim does NOT hold for the flagged code.
- A "true positive" (TP) means the rule fires correctly — even if you'd disable it as style.
- A "MIXED" rule has both TP and FP shapes — describe the FP shape specifically.
- A "STYLE" rule fires correctly per its definition but is purely stylistic preference. Mark as STYLE, not FP.

YOUR TASK:
Classify every rule in `/tmp/fp-chunk-<target>-<bucket>.txt`. Read the samples. When a snippet is ambiguous, open the actual source at /tmp/tc-targets/<target>/<path> and read 10–20 lines of context.

Rule visitors live at packages/analyzer/src/rules/*/visitors/{javascript,python}/<rule>.ts.

OUTPUT FORMAT, one block per rule:

## <rule-key> (<count>)
verdict: TP | FP | MIXED | STYLE
notes: <1–2 lines>
fp_shape: <only if FP/MIXED — describe the false-positive pattern precisely>
fp_examples: <only if FP/MIXED — 2–3 file:line refs>

PRIORITIZE: real-bug rules over style/measurement rules. The user wants ACTIONABLE FPs the analyzer can be fixed on.

Cap response to 4000 tokens. Source: /tmp/tc-targets/<target>/.
```

Agents run in parallel via `run_in_background: true`. Each gets fresh context — they don't carry the main session's "I already classified this" momentum, which is the largest source of unreliable verdicts (see Lessons).

### Step 3: Aggregate

When all agents return, merge their classifications into `FP-ANALYSIS-<target>.md` (one section per agent's output, plus a top summary). The fix queue is the FP + MIXED entries, ordered by count.

## Known-style skip list

These rules fire correctly per their definition but are purely stylistic preferences. They will NEVER be FPs and should be skipped from agent classification (no investigation, no fix work). When new STYLE rules are confirmed across multiple targets, append them here.

```
# Style/measurement rules — TP by definition, never FP

code-quality/deterministic/magic-number
code-quality/deterministic/magic-string
code-quality/deterministic/magic-value-comparison
code-quality/deterministic/missing-return-type
code-quality/deterministic/missing-boundary-types
code-quality/deterministic/missing-type-hints
code-quality/deterministic/mixed-type-imports
code-quality/deterministic/mixed-type-exports
code-quality/deterministic/no-return-await
code-quality/deterministic/cyclomatic-complexity
code-quality/deterministic/cognitive-complexity
code-quality/deterministic/expression-complexity
code-quality/deterministic/too-many-lines
code-quality/deterministic/too-many-positional-arguments
code-quality/deterministic/too-many-return-statements
code-quality/deterministic/too-many-branches
code-quality/deterministic/too-many-breaks
code-quality/deterministic/deep-callback-nesting
code-quality/deterministic/deeply-nested-functions
code-quality/deterministic/unknown-catch-variable
code-quality/deterministic/console-log
code-quality/deterministic/duplicate-string
code-quality/deterministic/sorting-style
code-quality/deterministic/import-formatting
code-quality/deterministic/typing-only-import
code-quality/deterministic/raw-string-in-exception
code-quality/deterministic/raise-vanilla-args
code-quality/deterministic/private-member-access
code-quality/deterministic/no-self-use
code-quality/deterministic/inferrable-types
code-quality/deterministic/nested-template-literal
code-quality/deterministic/negated-condition
code-quality/deterministic/manual-from-import
code-quality/deterministic/compare-to-empty-string
code-quality/deterministic/star-import
code-quality/deterministic/static-method-candidate
code-quality/deterministic/prefer-single-boolean-return
code-quality/deterministic/prefer-while
code-quality/deterministic/boolean-trap
code-quality/deterministic/boolean-parameter-default
code-quality/deterministic/selector-parameter
code-quality/deterministic/type-guard-preference
code-quality/deterministic/redefined-loop-name
code-quality/deterministic/reimplemented-builtin
code-quality/deterministic/deeply-nested-fstring
code-quality/deterministic/type-check-without-type-error
code-quality/deterministic/async-promise-function
code-quality/deterministic/mutable-private-member
code-quality/deterministic/ungrouped-shorthand-properties
code-quality/deterministic/empty-function
code-quality/deterministic/no-empty-function
code-quality/deterministic/missing-destructuring
code-quality/deterministic/unused-expression
code-quality/deterministic/undefined-assignment
code-quality/deterministic/public-static-readonly
code-quality/deterministic/unnecessary-type-union
performance/deterministic/missing-react-memo
performance/deterministic/inline-function-in-jsx-prop
performance/deterministic/inline-object-in-jsx-prop
reliability/deterministic/console-error-no-context
reliability/deterministic/catch-without-error-type
reliability/deterministic/unchecked-array-access
bugs/deterministic/empty-catch
bugs/deterministic/loose-boolean-expression
style/deterministic/docstring-completeness
style/deterministic/python-minor-style-preference
```

Curate this list as new STYLE rules are confirmed. Don't pre-populate from rule names alone — only add a rule once an agent has classified it as STYLE on at least one target with concrete sample evidence.

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
- Fixtures must use **realistic** code shapes, not synthetic toy snippets. Source the shape from the actual FP in the target repo (the analysis doc has file:line refs).
- One rule per commit so each fix is bisectable.
- **Full green or not done.** Never use phrases like "pre-existing failure", "unrelated to my changes", or "out of scope" to defer a red test. Investigate, root-cause, fix. The only signal that work is complete is full green.

## Test commands

```bash
# All tests, save full output
pnpm test 2>&1 | tee /tmp/test-output.txt

# Fixture-specific suites (fast iteration during a fix)
pnpm test tests/analyzer/js-positive.test.ts
pnpm test tests/analyzer/python-positive.test.ts
pnpm test tests/analyzer/js-negative.test.ts
pnpm test tests/analyzer/python-negative.test.ts
```

## Fixture conventions

- **Positive fixture root**: `tests/fixtures/sample-{js,python}-project-positive/`. Test runner walks recursively and asserts `violations.length === 0`. Any code added here must not trigger any rule.
- **Negative fixture root**: `tests/fixtures/sample-{js,python}-project-negative/`. Test runner parses `// VIOLATION: <rule-key>` comments (`# VIOLATION:` for Python). Each marker MUST match a violation on the next line, and unexpected violations fail the test.
- **Service layout**: both fixtures use the same multi-service shape (`api-gateway`, `user-service`, `notification-service`, `web`, `infrastructure`). Match new code to the service whose role best fits.
- **Realism**: per `CLAUDE.md` and memory, fixtures must look like production code. Lift the snippet from the actual target FP nearly verbatim, with naming adapted to the service.

## Phase 3 — Cross-target verification

Every fix applies to every target. After landing each fix:

1. `pnpm build` in the worktree.
2. Re-analyze every target whose Phase 1 analysis fed the queue.
3. Confirm: the rule's count went down on at least one target, and did NOT go up on any target. Update each target's `FP-ANALYSIS-<target>.md` with the post-fix count.

When the queue is exhausted, the goal state is:
- Every rule that still fires has been confirmed TP on every remaining finding (or the count is 0).
- "0 critical, low residual high" is not enough; if medium tier still has known FPs, the queue isn't exhausted.

```bash
# Re-analyze a target against the latest worktree build
cd /tmp/tc-targets/<repo> && rm -rf .truecourse && \
  node <worktree>/tools/cli/dist/index.js analyze --no-llm --no-skills --no-stash
```

## What not to do

- Do not add a "skip" / "exclude" config option as a fix when the rule logic itself is wrong. The fix has to be in the rule.
- Do not turn off rules. Rule-level disables hide problems; we want them tightened, not silenced.
- Do not refactor adjacent code. Bug-fix-shaped commits only.
- Do not add comments explaining the fix. The commit message + the fixture pair are the documentation.
- Do not classify a rule as TP after looking at 4 samples. Use ≥8, plus source context.
- Do not skip Phase 0 ("check known FP shapes") when picking up a new target — you'll re-do work already done on previous targets.

## Lessons learned

These observations come from the documenso + OpenHands runs (FP #1 → #26+). Encoded into the protocol above so we don't repeat them.

- **4-sample classifications are unreliable.** Rules I'd called TP after 4 samples (`unbound-method`, `prototype-pollution`, `await-in-loop`, `timing-attack-comparison`) had clear FP classes I missed. Always sample ≥8 findings per rule, and read the surrounding source code when ambiguous.
- **STYLE ≠ FP.** A rule that fires correctly per its definition but is purely opinionated isn't an FP — it's a configurable preference. Don't burn cycles trying to "fix" them. Keep the known-style skip list current.
- **Agents return more reliable classifications than the main session.** Each spawned agent has fresh context and reads source carefully. The main session accumulates "I already classified this" momentum that biases verdicts. Use Phase 1 agents — don't classify by hand.
- **Cross-target verification matters.** A fix that drops the count on documenso must NOT raise it on OpenHands (or vice versa). Always re-run both targets after a fix.
- **Test files don't have modules — but they DO consume them.** Service-level cross-service-import detection must count consumers from file-level deps, not module-level. Tests are real consumers of shared infrastructure even if their files export nothing.
- **`{ dot: true }` for `**` globs.** Worktrees live under `.claude/worktrees/`; any rule using minimatch on absolute paths needs `{ dot: true }` to match through the dot segment. Otherwise the rule silently fails when run from a worktree but works from a normal checkout.
- **Hooks are the only mechanism that forces protocol adherence.** Memory entries, CLAUDE.md, and this strategy doc are reminders the working agent can still bypass under pressure. If protocol slippage becomes a recurring problem, encode a `PreToolUse` hook on Edit/Write that blocks rule-code edits unless a fixture file was touched first.
