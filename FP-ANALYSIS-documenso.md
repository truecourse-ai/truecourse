# FP Analysis — documenso

Source: `truecourse@latest analyze --no-llm --no-skills --no-stash` against shallow clone of `documenso/documenso` at `/tmp/tc-targets/documenso`. Run after the FP fixes from commits `97fcc99..0c816bd` (the v0.5.7 → fp-fixes delta).

## Current totals (post FP #31)

| Tier | v0.5.7 baseline | Current | Δ |
|---|---|---|---|
| critical | 18 | **0** | -18 |
| high | 4,929 | **577** | -88% |
| total | 57,351 | **19,197** | -38,154 |

NOTE: post-FP #29 onward analyses run with `node_modules` installed in the
target. With cross-package types resolving, many type-aware rules now correctly
filter their findings (a side-effect of the env, not the rules), which explains
the steep medium-tier drop. The FP-fix counts below are per-rule not per-tier.

## Per-rule FP-fix progress (this session: FP #28–#31)

| Rule | Pre-fix | Post-fix | Δ |
|---|---|---|---|
| `bugs/deterministic/missing-error-boundary` | 91 | **1** | -90 (FP #28) |
| `reliability/deterministic/unchecked-array-access` | 80 | **30** | -50 (FP #29; remaining are real array indexes) |
| `performance/deterministic/runtime-cast-overhead` | 0 | **0** | (Python-only rule, no JS effect) |
| `code-quality/deterministic/filename-class-mismatch` | 41 | **3** | -38 (FP #31; remaining are genuine name divergence) |
| `architecture/deterministic/dead-method` | 47 | **21** | -26 (FP #32 + #33: shorthand methods + framework-routed files) |
| `architecture/deterministic/unused-export` | 40 | **34** | -6 (FP #33; Remix routes now treated as entry points) |
| `architecture/deterministic/dead-module` | 35 | **13** | -22 (FP #33; BullMQ job definitions + Remix route files now entry points) |
| `code-quality/deterministic/hardcoded-url` | 43 | **26** | -17 (FP #34; canonical-site-URL config keys + email-template default-link params) |
| `code-quality/deterministic/unnecessary-type-parameter` | 26 | **2** | -24 (FP #40; default value, body usage, parametric input, inferred return) |
| `code-quality/deterministic/react-useless-set-state` | 13 | **0** | -13 (FP #41; param/local-decl shadowing) |
| `bugs/deterministic/void-return-value-used` | 7 | **0** | -7 (FP #42; splice/pop/shift/delete return useful values) |
| `bugs/deterministic/missing-return-await` | 10 | **2** | -8 (FP #43; Hono context + Zod parse + stream helpers) |
| `reliability/deterministic/process-exit-in-library` | 11 | **2** | -9 (FP #44; examples/ + bin/ + shebang) |
| `security/deterministic/insecure-random` | 6 | **0** | -6 (FP #45; seed/mocks/test/storybook paths) |

214 distinct rules firing initially → many fewer effective FP-class rules now.

## Additional FP classes found in deeper second-pass investigation (FP #22–#26)

Rules I'd dismissed as TP/STYLE on quick samples that turned out to have real FP shapes on closer look:

- `bugs/deterministic/unbound-method` — fired on `this._dataField` references (Redis connections, queues, Maps); rule was treating any `this.X` value-use as a method reference. Fix: walk class_body, skip when X is declared as a field. **25 → 0 documenso.**
- `bugs/deterministic/prototype-pollution` — fired on numeric loop counters and forEach `(_, index)` callback indexes (numbers can never stringify to `__proto__`). Fix: detect iteration-callback 2nd-param + `let i = 0` numeric counters. **9+7 → 7+6.**
- `security/deterministic/timing-attack-comparison` — second pass found 3 more shapes beyond enum tags: presence checks (`X !== ''`, `X === null`, `X === false`), `.id` / `.length` access, same-receiver self-compare (form validation), and `typeof X` type checks. **53 → 12 documenso.**
- `bugs/deterministic/await-in-loop` — fired on `while ((await reader.read()).done)` ReadableStream consumption (sequential by protocol). Fix: skip `await X.read()` / `await X.next()`. **6 → 0 in stream-consuming files.**

Lesson: 4-sample classifications are unreliable. Going rule-by-rule with 8+ samples + reading source context found 5 additional FP classes I'd missed.

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
| TP/CALIBRATION | `code-quality/deterministic/unsafe-any-usage` | 44,203 | After investigation: every flagged value is genuinely typed as `any` per TS — rule is technically correct. Volume comes from library-induced `any` (Prisma, `req.body`, `process.env` etc.) propagating through every member access / call. Distribution: 64% member-access, 24% call, 13% assignment. Top file 484 findings (`packages/api/v1/implementation.ts`). Reducing noise is **calibration**, not strict FP-fix: candidates are (a) aggregate per-symbol-per-file (~95% reduction), (b) skip when the `any` originates from a third-party import, (c) demote severity. NOT in the FP queue. |
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
| STYLE | `code-quality/deterministic/dot-notation-enforcement` | 76 | Initial classification was FP, but on review the cases (`signer['nativeId']`, `errors['signers__root']`, `__OWNER__`, `client['sessions']`) are all valid JS identifiers. Bracket notation is stylistic, dot notation works equally. Real TPs that some teams disable as a style preference. |
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
| ~~3~~ | ~~`code-quality/deterministic/dot-notation-enforcement`~~ | ~~76~~ | RECLASSIFIED as STYLE, not FP. See above. |
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
