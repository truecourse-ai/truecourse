# FP Analysis — documenso

Source: `truecourse@latest analyze --no-llm --no-skills --no-stash` against shallow clone of `documenso/documenso` at `/tmp/tc-targets/documenso`. Run after the FP fixes from commits `97fcc99..0c816bd` (the v0.5.7 → fp-fixes delta).

## Current totals

| Tier | Count |
|---|---|
| critical | 0 |
| high | 1,123 |
| medium | 47,724 |
| low | 4,222 |
| **total** | **53,069** |

214 distinct rules firing.

## Classification

Format: `Verdict — rule-key (count)`. Verdicts are:
- **TP** — rule fires correctly; the flagged code is the thing the rule is meant to detect.
- **FP** — rule fires incorrectly; the semantic claim doesn't hold for the flagged code.
- **MIXED** — both TP and FP shapes; specific FP shape called out.
- **STYLE** — rule fires correctly per its definition, but it's a stylistic preference rather than a bug. Left as TP for analyzer correctness; configurability is separate.
- **TODO** — not yet examined; needs a future pass.

### High-volume rules examined

| Verdict | Rule | Count | Notes |
|---|---|---|---|
| MIXED | `code-quality/deterministic/unsafe-any-usage` | 44,203 | Flags every expression typed as `any`. Many are real (ill-typed third-party / explicit `any`). Some are FPs where TS *can* infer a type but the analyzer doesn't see it. Needs deeper investigation — biggest single noise source. |
| TP | `code-quality/deterministic/too-many-lines` | 976 | Function/file length measurement — fires correctly. |
| TP | `code-quality/deterministic/magic-number` | 544 | Real magic numbers (`429`, `4000`). Pedantic but TPs. |
| TODO | `architecture/deterministic/cross-service-internal-import` | 433 | Original report suspected FP. Not investigated this pass. |
| TP | `code-quality/deterministic/missing-return-type` | 400 | Real missing return types. Style. |
| TP | `code-quality/deterministic/expression-complexity` | 351 | Measurement. |
| TP | `code-quality/deterministic/missing-boundary-types` | 338 | Real missing boundary types. Style. |
| TP | `code-quality/deterministic/unknown-catch-variable` | 282 | Real `catch (error)` without `: unknown`. Style. |
| STYLE | `performance/deterministic/inline-function-in-jsx-prop` | 226 | Real inline arrows in JSX. Some teams accept these. |
| STYLE | `code-quality/deterministic/no-return-await` | 215 | `return await x()` style preference. |
| TP | `code-quality/deterministic/duplicate-string` | 214 | Real duplicate string literals. |
| TP | `code-quality/deterministic/magic-string` | 206 | Same. |
| **FP** | `bugs/deterministic/void-zero-argument` | 201 | Flags `void someAsync()` (fire-and-forget Promise — canonical TS pattern for no-floating-promises). |
| **FP** | `code-quality/deterministic/no-void` | 201 | Same FP class as above; same `void someAsync()` pattern. |
| MIXED | `code-quality/deterministic/require-await` | 177 | `async () => deleteThing()` (no `await`) returns the inner Promise. Some teams require explicit `await`. Edge of FP/style. |
| STYLE | `code-quality/deterministic/mixed-type-imports` | 168 | Real mix of value+type imports. Style. |
| STYLE | `reliability/deterministic/catch-without-error-type` | 157 | Same as `unknown-catch-variable`. |
| TODO | `reliability/deterministic/promise-all-no-error-handling` | 144 | Original report suspected FP. Need to verify whether `await Promise.all([...])` inside a `try/catch` (or as a returned value) genuinely needs explicit `.catch()`. |
| TP | `code-quality/deterministic/cyclomatic-complexity` | 135 | Measurement. |
| STYLE | `style/deterministic/sorting-style` | 130 | Import sorting style. |
| STYLE | `code-quality/deterministic/readonly-parameter-types` | 116 | Style. |
| STYLE | `reliability/deterministic/console-error-no-context` | 103 | `console.error(err)` without context message. Pedantic. |
| MIXED | `bugs/deterministic/loose-boolean-expression` | 96 | `if (url)` where `url` is `string \| undefined`. Some teams require explicit `!== undefined`. |
| **FP** | `security/deterministic/timing-attack-comparison` | 95 | Flags non-security comparisons (`field.type === FieldType.SIGNATURE`, `data.password === data.repeatedPassword` UI-form validation). Should fire only on credential / token comparisons. |
| TP | `code-quality/deterministic/deep-callback-nesting` | 92 | Real nesting. Measurement. |
| TP | `code-quality/deterministic/commented-out-code` | 91 | Real commented-out code. |
| TP | `bugs/deterministic/missing-error-boundary` | 90 | React error boundary check. |
| TP | `code-quality/deterministic/deeply-nested-functions` | 89 | Measurement. |
| TP | `bugs/deterministic/duplicate-import` + `architecture/deterministic/duplicate-import` | 87 each | Real duplicate imports of the same module. |
| TODO | `database/deterministic/unvalidated-external-data` | 87 | Not investigated — needs check whether all are real Prisma writes from un-Zod-validated input. |
| TP | `reliability/deterministic/unchecked-array-access` | 80 | `arr[index]` without bounds check. Real. |
| TP | `code-quality/deterministic/todo-fixme` | 79 | Real TODO/FIXME comments. |
| **FP** | `code-quality/deterministic/dot-notation-enforcement` | 76 | Flags `obj['key']` where bracket notation is intentional — keys with special characters (`signer['nativeId']`), reserved-name disambiguation, or framework-specific access (`client['accounts'].$get()` in Hono client). |
| TP | `bugs/deterministic/generic-error-message` | 69 | Real "An error occurred"-style messages. Style. |
| TP | `bugs/deterministic/await-in-loop` | 69 | Real serial `await` in loops. Some are intentional. Style. |
| TP | `code-quality/deterministic/cognitive-complexity` | 68 | Measurement. |
| STYLE | `code-quality/deterministic/require-unicode-regexp` | 66 | Pedantic. |
| TP | `performance/deterministic/inline-object-in-jsx-prop` | 63 | Real inline objects in JSX. Style. |
| TP | other style/measurement rules <60 each | various | Mostly TPs. |

### Lower-volume rules (sampled, brief verdicts)

| Verdict | Rule | Count | Notes |
|---|---|---|---|
| **FP** | `code-quality/deterministic/computed-enum-value` | 32 | Flags TS string enums (`COMPLETED = 'completed'`) — string enums are first-class TS, not "computed values". |
| TP | `bugs/deterministic/unbound-method` | 25 | Real method-reference passes without `.bind`. |
| TP | `architecture/deterministic/route-without-auth-middleware` | 24 | Routes mounted without auth middleware. |
| MIXED | `bugs/deterministic/non-number-arithmetic` | 23 | Some flagged ops are clearly numeric (`pointerPosition.x / scale`); rule may not infer types. Need closer look. |
| TP | many smaller rules | 1–22 each | Sampled; mostly TPs or known-FP-already-fixed. Long tail not yet exhaustively classified. |

## Fix queue (priority by FP volume)

Built from FP-classified rules above, ordered by total findings.

| # | Rule | Count | Shape |
|---|---|---|---|
| 1 | `code-quality/deterministic/no-void` + `bugs/deterministic/void-zero-argument` | 201 + 201 = **402** | `void someAsync()` (fire-and-forget Promise pattern). |
| 2 | `security/deterministic/timing-attack-comparison` | 95 | Non-credential equality checks flagged. Restrict to known credential/token operands. |
| 3 | `code-quality/deterministic/dot-notation-enforcement` | 76 | Bracket notation when key has special chars / is intentional. |
| 4 | `code-quality/deterministic/computed-enum-value` | 32 | TS string enum members. |

**Not yet in queue (TODO investigation):**
- `code-quality/deterministic/unsafe-any-usage` (44,203) — too large to attack without deeper sampling. Likely both FPs and real `any` uses mixed.
- `architecture/deterministic/cross-service-internal-import` (433)
- `reliability/deterministic/promise-all-no-error-handling` (144)
- `database/deterministic/unvalidated-external-data` (87)
- The long tail of <60-finding rules — sampled but not exhaustively read.

## Reproduce

```bash
cd /tmp/tc-targets/documenso && rm -rf .truecourse && \
  node <worktree>/tools/cli/dist/index.js analyze --no-llm --no-skills --no-stash
```
