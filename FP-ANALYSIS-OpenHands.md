# FP Analysis — OpenHands

Source: `truecourse@latest analyze --no-llm --no-skills --no-stash` against shallow clone of `All-Hands-AI/OpenHands` at `/tmp/tc-targets/OpenHands`. Run after the FP fixes from commits `97fcc99..0c816bd`.

## Current totals (post FP #26)

| Tier | v0.5.7 baseline | Current | Δ |
|---|---|---|---|
| critical | 69 | **5** (all real) | -64 |
| high | 1,014 | **361** | -64% |
| medium | 14,115 | 14,039 | -76 |
| low | 9,515 | 7,996 | -1,519 |
| **total** | **25,115** | **22,401** | -2,714 |

297 distinct rules firing.

The 5 remaining critical are all true positives:
- 2× PostHog client keys (`phc_3ESMmY9SgqEAGBB6sMGK5ayYHkeUuknH2vP6FmWH9RA`) — public-by-design but real keys.
- 3× hooks-in-ternary-branches in `openhands-ui/components/tooltip/Tooltip.tsx:82-83` — genuine Rules of Hooks violations (`condition ? [useClick(...)] : [useHover(...), useFocus(...)]`).

## Classification

### High-volume rules examined

| Verdict | Rule | Count | Notes |
|---|---|---|---|
| MIXED | `code-quality/deterministic/unsafe-any-usage` | 11,405 | Same as documenso — flags every `any`. Many real, some FPs from poorly-typed third-party. |
| **FP** | `code-quality/deterministic/computed-enum-value` | 1,519 | Flags TS string enums (`MAINTENANCE$SCHEDULED_MESSAGE = "MAINTENANCE$SCHEDULED_MESSAGE"`). String enums are first-class TS. |
| STYLE | `style/deterministic/python-minor-style-preference` | 790 | Python style rule. |
| STYLE | `style/deterministic/docstring-completeness` | 777 | Missing docstrings — pedantic but real. |
| TP | `code-quality/deterministic/missing-return-type` | 554 | Real missing return types. |
| TP | `code-quality/deterministic/missing-boundary-types` | 481 | Real. |
| TP | `code-quality/deterministic/too-many-lines` | 466 | Measurement. |
| STYLE | `code-quality/deterministic/typing-only-import` | 441 | Should use `import type`. Pedantic. |
| MIXED | `code-quality/deterministic/no-self-use` | 381 | Methods that don't use `self`. Could be intentional (interface implementation). |
| TP | `code-quality/deterministic/react-readonly-props` | 314 | Real — props not marked readonly. |
| TP | `code-quality/deterministic/missing-type-hints` | 304 | Real Python missing types. |
| STYLE | `code-quality/deterministic/raw-string-in-exception` | 303 | `raise ValueError("msg")` style — should subclass. Pedantic. |
| TP | `code-quality/deterministic/duplicate-string` | 283 | Real duplicates. |
| MIXED | `code-quality/deterministic/require-await` | 248 | `async def` with no `await` — could be interface compatibility (e.g., implementing async protocol). |
| STYLE | `code-quality/deterministic/import-outside-top-level` | 240 | Lazy imports for circular-dep avoidance. Often intentional. |
| TP | `code-quality/deterministic/magic-number` | 236 | Real magic numbers. Pedantic. |
| MIXED | `code-quality/deterministic/no-explicit-any` | 207 | Sometimes `Any` is the right type for dict[str, Any] payloads from external sources. |
| MIXED | `code-quality/deterministic/async-unused-async` | 182 | Same as `require-await`. |
| TP | `bugs/deterministic/raise-without-from-in-except` | 175 | Real Python anti-pattern (loses traceback). |
| STYLE | `performance/deterministic/inline-function-in-jsx-prop` | 168 | Same as documenso. |
| STYLE | `style/deterministic/sorting-style` | 140 | Style. |
| TP | `code-quality/deterministic/expression-complexity` | 140 | Measurement. |
| TP | `code-quality/deterministic/cyclomatic-complexity` | 135 | Measurement. |
| STYLE | `style/deterministic/import-formatting` | 133 | Style. |
| STYLE | `code-quality/deterministic/try-consider-else` | 105 | Pedantic. |
| MIXED | `code-quality/deterministic/unnecessary-assign-before-return` | 104 | Sometimes intentional for debugging. |
| STYLE | `code-quality/deterministic/fastapi-undocumented-exception` | 98 | OpenAPI-completeness pedantic. |
| TP | `code-quality/deterministic/cognitive-complexity` | 97 | Measurement. |
| STYLE | `code-quality/deterministic/raise-vanilla-args` | 89 | Should subclass Exception. |
| TP | `architecture/deterministic/unused-import` | 87 | Real unused imports. |
| TP | `code-quality/deterministic/too-many-positional-arguments` | 86 | Measurement. |
| TP | `code-quality/deterministic/magic-string` | 86 | Real. |
| STYLE | `code-quality/deterministic/private-member-access` | 81 | `_method` accessed externally. Sometimes intentional in test code. |
| STYLE | `code-quality/deterministic/fastapi-non-annotated-dependency` | 80 | Should use `Annotated[...]`. |
| TP | `code-quality/deterministic/magic-value-comparison` | 79 | Real. |
| MIXED | `bugs/deterministic/loose-boolean-expression` | 77 | Same as documenso. |
| STYLE | `code-quality/deterministic/readonly-parameter-types` | 74 | Style. |
| STYLE | `performance/deterministic/inline-object-in-jsx-prop` | 74 | Style. |
| STYLE | `code-quality/deterministic/require-unicode-regexp` | 71 | Pedantic. |
| MIXED | `code-quality/deterministic/assert-in-production` | 65 | `assert` in code — could be a pre-condition check. Some teams want explicit raise. |
| STYLE | `code-quality/deterministic/explicit-fstring-conversion` | 63 | f-string with `str(e)` — could just use `{e}`. |
| TP | `code-quality/deterministic/too-many-return-statements` | 62 | Measurement. |
| STYLE | `code-quality/deterministic/error-instead-of-exception` | 62 | `logger.error` vs `logger.exception`. |
| TP | `performance/deterministic/runtime-cast-overhead` | 59 | Real `str(...)` inside hot loops. |

### Lower-volume rules (sampled, brief verdicts)

Long tail not exhaustively classified. Most are TPs or already-known FPs — see fix queue.

## Fix queue (priority by FP volume)

Built from FP-classified rules. Combined with documenso for shared queue:

| # | Rule | Count (doc + OpenHands) | Shape |
|---|---|---|---|
| 1 | `code-quality/deterministic/computed-enum-value` | 32 + 1,519 = **1,551** | TS string enum members. |
| 2 | `code-quality/deterministic/no-void` + `bugs/deterministic/void-zero-argument` | 402 + 0 = **402** | `void someAsync()` fire-and-forget. |
| 3 | `security/deterministic/timing-attack-comparison` | 95 + ? = **95+** | Non-credential equality flagged. |
| 4 | `code-quality/deterministic/dot-notation-enforcement` | 76 + ? = **76+** | Bracket notation when intentional. |

**Not yet in queue (TODO investigation):**
- `unsafe-any-usage` (44k + 11k) — biggest noise source. Mixed FP/TP. Needs deep dive.
- `cross-service-internal-import` (433 doc, 4 OH) — original-report FP suspect.
- `promise-all-no-error-handling` (144 doc, 2 OH) — original-report FP suspect.
- The MIXED rules above — each needs investigation to identify FP shape vs TP shape.
- The long tail of <50-finding rules — sampled but not exhaustively read.

## Reproduce

```bash
cd /tmp/tc-targets/OpenHands && rm -rf .truecourse && \
  node <worktree>/tools/cli/dist/index.js analyze --no-llm --no-skills --no-stash
```
