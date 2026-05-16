# Plan to reach all-green tests

**Goal:** every rule fires 0 times in positive fixture project AND every `// VIOLATION:` marker in negative fixture is detected. No compromise on the strict `positive_count == 0` contract.

## Baseline (as of plan write)

- 175 eligible rules
- 63 fixed (51 in commit `e1bd84b1` + 12 individual `stage5: fix <rule>` commits)
- 54 skipped with logged reasons
- 58 untouched (in queue, not yet attempted)

## What's blocking the remaining 112

| Block | Rules | Why | Fix |
|---|---|---|---|
| A. Stage-3 fixture defects | ~30 | positive AST identical to negative TP | regenerate stage 3 fixture with AST-distinguishable shape |
| B. Missing typeQuery wiring | ~6 | visitor can't ask TS compiler about types | wire typeQuery into those visitors |
| C. Data-flow lib bugs | 1 | `use-before-define` mishandles `declare const`+re-exports | fix data-flow analyzer |
| D. Partial-fix rules | 9 | each has one FP shape the guard misses without killing TP | resolves under A or B |
| E. Untouched queue | 58 | not attempted | will succeed/fail per A–D |

## Phases

### Phase A — Fix stage 3 fixture defects (in progress)

For each rule listed as "fixture defect" in `fp-audit/state/decisions.jsonl`:

1. Read the original FP `why` text in fp.jsonl
2. Read the current positive fixture + the negative TP marker — identify the structural collision
3. Regenerate the positive fixture with a syntactic feature the negative TP doesn't have (different AST node, different surrounding context, different identifier pattern that the visitor can key off)
4. Verify: rule fires on negative TP, does NOT fire on regenerated positive
5. Commit: `stage3-regen: <rule>`

Output: stage 3 fixtures where every `(rule, shape)` has positive ≠ negative at AST level.

### Phase B — Wire typeQuery into visitors that need it (~6 rules)

Affected (initial list — expand as more are discovered):
- `bugs/deterministic/missing-return-await`
- `bugs/deterministic/inconsistent-return`
- `bugs/deterministic/non-number-arithmetic`

For each:

1. Set `needsTypeQuery: true` on the visitor
2. Use `typeQuery.getReturnType(node)` / `typeQuery.getInferredType(node)` to discriminate Promise vs non-Promise, void vs T, string vs number, etc.
3. Ensure both `js-positive.test.ts` and `js-negative.test.ts` pass typeQuery to `checkCodeRules`
4. Commit per rule: `stage5-typequery: <rule>`

### Phase C — Fix data-flow library (`use-before-define`)

- Skip `declare const` in data-flow (ambient declarations have no runtime ordering)
- Follow `export … from './foo'` re-exports when resolving symbols
- Single targeted patch to `packages/analyzer/src/...` (find the data-flow analyzer location)
- Commit: `stage5: fix data-flow analyzer (declare-const + re-exports)`

### Phase D — Re-run stage 5 on all unblocked rules + 58 untouched

After A/B/C land:
- Re-run stage 5 SKILL with original strict contract (`positive_count == 0`)
- One sub-agent per rule, sequential, per-rule commit
- Expected: ~95-100% of remaining rules converge

### Phase E — Stage 6 audit + close out

- Re-analyze documenso with new analyzer
- Verify FP rows flip from `fix-attempted` to `fixed`, not `surviving`
- Run js-positive + js-negative — both fully green

## Time

| Phase | Work | Estimated |
|---|---|---|
| A | 30 fixtures × 15 min | 6–8 h |
| B | 6 visitors × 45 min | 4–5 h |
| C | data-flow bug fix | 1–2 h |
| D | 70 rules × 3 min | 3–4 h |
| E | audit + verify | 1–2 h |
| **Total** | | **15–22 h** |

## Order

- A and B are independent — can run in parallel
- C is single targeted fix
- D requires A+B+C done
- E requires D done

## Resumability

Each phase produces commits. Re-running the plan re-reads:
- `fp-audit/state/decisions.jsonl` (skipped rules + reasons)
- `git log --grep "stage3-regen:"` (Phase A progress)
- `git log --grep "stage5-typequery:"` (Phase B progress)
- `git log --grep "stage5: fix"` (Phase D progress)

Anything already committed is skipped.

## Failure modes to watch

- **Fixture regen still collides**: a rule's positive shape may have no AST distinction from its negative shape because the original FP was a semantic-context FP (e.g., `unnamed-regex-capture` where the distinction is data-flow). Mark these in `fp-audit/state/unresolvable.jsonl` for category-change decision (move to LLM-mode or disable).
- **typeQuery integration changes other rules**: changing visitor signatures could regress other rules. Re-run all js-positive + js-negative after each Phase B commit.
- **Phase C breaks unrelated rules**: data-flow is shared. Watch for ripple effects after the patch.
