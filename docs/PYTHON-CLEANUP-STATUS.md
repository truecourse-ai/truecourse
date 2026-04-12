# Python Visitor Cleanup — Status

Multi-phase effort to eliminate false positives in the Python analyzer
visitors. Battle-tested against `arnata-brain` (693 Python files).

**Starting baseline (pre-Phase-1):** 12,873 violations across 224 rules,
~4,508 false positives (~35% FP rate) verified by parallel sampling agents.

**Current state (after Phase 4):** 10,588 violations, **-2,285 false positives**
cumulative (17.8% reduction).

---

## Phase 1 — Shared helpers infrastructure — ✅ COMPLETE

Built the foundation the later phases depend on. No visitor migrations.

**Files added:**
- `packages/analyzer/src/rules/_shared/python-helpers.ts`
  — `containsPythonIdentifierExact`, `containsPythonCallTo`,
  `getEnclosingPythonFunction`, `isInsidePythonTypeAnnotation`,
  `getPythonDecoratorName`, `getPythonModuleNode`
- `packages/analyzer/src/rules/_shared/python-framework-detection.ts`
  — `getPythonImportSources` (WeakMap-cached), `detectPythonOrm`,
  `detectPythonWebFramework`, `detectPythonDataLib`, `importsAwsSdk`,
  `importsPydantic`, `importsFastApi`, `importsPandas`, `importsNumpy`,
  `importsDjango`, `importsSqlAlchemy`, `isFastApiDependsCall`,
  `isPydanticFieldCall`, `isPydanticModelClass`, `isDjangoModelClass`,
  `isPythonAuthDecoratorName`, `isSqlAlchemyColumnCall`,
  `isSqlAlchemyMappedAnnotation`

**Tests added:**
- `tests/analyzer/python-shared-helpers.test.ts` — 41 tests
- `tests/analyzer/python-framework-detection.test.ts` — 118 tests

Mirror JS `_shared/javascript-helpers.ts` and `_shared/framework-detection.ts`.

---

## Phase 2 — Framework-detection migrations — ✅ COMPLETE

Rewired 15 Python visitors + 1 bonus (`console-log`) to gate on the correct
library being imported, using Phase 1 helpers.

### Visitors migrated

| Rule | Before | After | Status |
|---|---|---|---|
| `code-quality/deterministic/boto3-pagination` | 226 | 0 | ✅ -226 (100%) |
| `code-quality/deterministic/django-model-without-str` | 222 | 0 | ✅ -222 (100%) |
| `bugs/deterministic/function-call-in-default-argument` | 150 | 0 | ✅ -150 (100%) |
| `code-quality/deterministic/builtin-shadowing` | 102 | 1 | ✅ -101 (99%) |
| `code-quality/deterministic/pandas-pipe-preferred` | 90 | 0 | ✅ -90 (100%) |
| `code-quality/deterministic/console-log` | 146 | 66 | ✅ -80 (55%) — bonus |
| `code-quality/deterministic/print-statement-in-production` | 86 | 37 | ✅ -49 (57%) |
| `code-quality/deterministic/pandas-use-of-dot-values` | 16 | 0 | ✅ -16 (100%) |
| `code-quality/deterministic/pandas-merge-parameters` | 5 | 0 | ✅ -5 (100%) |
| `code-quality/deterministic/pandas-accessor-preference` | 0 | 0 | ✅ gated (arnata had none) |
| `code-quality/deterministic/pandas-deprecated-accessor` | 0 | 0 | ✅ gated |
| `code-quality/deterministic/pandas-inplace-argument` | 0 | 0 | ✅ gated |
| `code-quality/deterministic/pandas-read-csv-dtype` | 0 | 0 | ✅ gated |
| `code-quality/deterministic/pandas-datetime-format` | 0 | 0 | ✅ gated |
| `bugs/deterministic/pandas-nunique-constant-series` | 0 | 0 | ✅ gated |
| `code-quality/deterministic/fastapi-non-annotated-dependency` | 120 | 125 | ✅ +5 TPs (now catches Query/Body/Path) |

**Regressions (+14) verified as real true positives:**
- `fastapi-non-annotated-dependency +5` — old rule only matched literal
  `Depends`; new rule matches all FastAPI DI helpers (Query/Body/Path/Header/
  Cookie/Form/File/Security).
- `unused-unpacked-variable +9` — old rule had a flaky `n === skipNode`
  proxy-identity comparison that intermittently masked real violations.
  After the scope-analyzer fix below, the rule catches them consistently.

### Scope analyzer proxy identity fix — ✅ COMPLETE

A bug class surfaced while debugging a test flake: tree-sitter's JS binding
returns a fresh `SyntaxNode` proxy on every field/child access, so
`node.parent === node.parent` is sometimes false for the same AST node.
Two concrete manifestations in the data-flow layer:

1. **`Map<SyntaxNode, Scope>` keyed by the proxy** — `scope-analyzer.ts` +
   `use-def-chains.ts` lost scope entries when later code walked
   `node.parent` to look them up.

2. **`===` identity checks in `isDeclarationPosition` helpers** — ~25
   comparisons like `parent.childForFieldName('name') === node` were
   non-deterministic.

**Fix:** key maps by `node.id` (stable `number`); compare nodes with
`.id === .id`. Same pattern used elsewhere in the codebase.

**Files modified:**
- `packages/analyzer/src/data-flow/scope-analyzer.ts`
- `packages/analyzer/src/data-flow/use-def-chains.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/unused-unpacked-variable.ts`
  (secondary flake — same bug class)

**Result:**
- `python-positive.test.ts` de-flaked (was 0–2 random FPs per run)
- `python-negative.test.ts` de-flaked (was missing `unused-unpacked-variable`
  at admin_controller.py:214 intermittently)
- `undefined-name -5` as a side-benefit

### Phase 2 files modified

**Visitors:**
- `packages/analyzer/src/rules/bugs/visitors/python/function-call-in-default-arg.ts`
- `packages/analyzer/src/rules/bugs/visitors/python/pandas-nunique-constant-series.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/boto3-pagination.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/builtin-shadowing.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/django-model-without-str.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/fastapi-non-annotated-dependency.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/pandas-accessor-preference.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/pandas-datetime-format.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/pandas-deprecated-accessor.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/pandas-inplace-argument.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/pandas-merge-parameters.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/pandas-pipe-preferred.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/pandas-read-csv-dtype.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/pandas-use-of-dot-values.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/print-statement-in-production.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/print.ts` (console-log rule)

**Tests updated:**
- `tests/analyzer/code-quality-rules.test.ts` — added 12 new Phase 2 unit
  tests covering `builtin-shadowing` (SQLAlchemy + Pydantic + dataclass +
  plain class + real TPs), `print-statement-in-production`, and `console-log`
  script-like skip
- `tests/analyzer/bugs-rules.test.ts` — added 3 new tests for
  `function-call-in-default-argument` FastAPI skip
- `tests/analyzer/python-framework-detection.test.ts` — added tests for
  `isSqlAlchemyColumnCall` and `isSqlAlchemyMappedAnnotation`

### Phase 2 deferred items

- **Fixture files:** two positive fixtures (`sqlalchemy_user.py`,
  `cli_tool.py`) were attempted but removed because they triggered
  unrelated rules (`typing-only-import`, `magic-value-comparison`,
  `import-formatting`, `shebang-error`) that are in Phase 6 scope. Unit
  tests cover the same patterns. Re-add in Phase 6 after those rules
  are fixed.

- **`print-statement-in-production` 37 remaining** and **`console-log` 66
  remaining**: production files that call `print()` outside a `__main__`
  guard. Some are real TPs; others may need further gating (e.g., skip
  based on logging-imports presence). Defer to Phase 6.

- **`builtin-shadowing` 1 remaining:** `input = {"state": state}` in
  `skill_execution.py:325` — this is a real TP (shadows the `input()`
  built-in at function scope). Leave as-is.

---

## Phase 3 — Scope / data-flow fixes — ✅ COMPLETE

**Battle test delta:** 11,943 → 10,594 (-1,349 FPs, -11.3%). Exceeded the
~900 FP target by 50% thanks to the combined scope-analyzer and rule-level
fixes.

### Rules fixed

| Rule | Before | After | Delta |
|---|---|---|---|
| `bugs/deterministic/falsy-dict-get-fallback` | 595 | 3 | **-592 (99.5%)** |
| `code-quality/deterministic/magic-value-comparison` | 595 | 36 | **-559 (94%)** |
| `bugs/deterministic/undefined-name` | 115 | 0 | **-115 (100%)** |
| `bugs/deterministic/default-except-not-last` | 83 | 0 | **-83 (100%)** |

**Remaining cases are verified true positives:**
- 3 `falsy-dict`: all real `d.get(k, falsy) or fallback` anti-pattern catches
- 36 `magic-value`: unexplained numbers (`padding != 4`, `page > 10`,
  `len(value) >= 14`, `ts > 10_000_000_000`) and URL-style string literals
  (`"/sync"`, `"/package/"`) that should be named constants

### Scope-analyzer improvements

The scope analyzer was missing five concrete Python constructs:

1. **Lambda scopes.** `lambda` was not in `PY_SCOPE_NODES`, so lambda
   parameters (`lambda x: x.id`) were not declared and `x` was reported as
   undefined. Fix: add `'lambda'` to `PY_SCOPE_NODES`, return `'function'`
   from `getScopeKind`, declare `lambda_parameters` children via a new
   `findPyLambdaAncestor` helper.

2. **Walrus operator `named_expression`.** PEP 572 walrus bindings
   (`if (data := compute()):`) were not recognized. Fix: add
   `named_expression.name` to `isPyDeclarationPosition`, declare the name
   via a new `findPyWalrusTargetScope` helper that skips comprehension
   scopes (per PEP 572 "leaked" binding semantics).

3. **Nested tuple unpacking in for loops.** `for i, (a, b) in ...` only
   declared `i` — the inner `(a, b)` pattern's children weren't found
   because the grandparent was `pattern_list`, not `for_statement`. Fix:
   walk up nested `tuple_pattern` / `pattern_list` / `list_pattern` nodes
   to find the root pattern before checking for `for_statement` /
   `assignment` as grandparent.

4. **Aliased dotted imports.** `import a.b.c as d` leaked `a`, `b`, `c`
   as undeclared references because the `dotted_name` parent chain ran
   through `aliased_import`, which wasn't in the import-position check.
   Fix: add `aliased_import` (and `relative_import` for `from ..pkg`
   form) to the parent-type check in `isPyDeclarationPosition`.

5. **Missing built-ins in `PYTHON_GLOBALS`.** ~55 Python exception
   classes and built-in functions were missing: `KeyboardInterrupt`,
   `SystemExit`, `TimeoutError`, `ConnectionError`, `ArithmeticError`,
   `LookupError`, `PermissionError`, `Warning`, `DeprecationWarning`,
   `chr`, `ord`, `bin`, `oct`, `hex`, `divmod`, `pow`, `NotImplemented`,
   `Ellipsis`, `__build_class__`, etc. Fix: expand `PYTHON_GLOBALS` in
   `known-globals.ts`.

### Rule-level fixes

- **`magic-value-comparison`** — added context-aware skip:
  - Skip if the other operand is `attribute` or `subscript` (e.g.
    `response.status == 200`, `row["status"] == 200`)
  - Skip idiomatic strings: dunder (`"__main__"`), HTTP methods, file
    extensions (`.pdf`), MIME types, enum-like identifiers (snake_case /
    UPPER_CASE, ≤32 chars)
  - Still fire on bare-identifier vs number (`count > 42`) and unexplained
    multi-word strings (`"really specific phrase"`)

- **`falsy-dict-get-fallback`** — rewrote to only catch the actual
  anti-pattern. Bare `d.get(k, 0)` is idiomatic and no longer flagged.
  The rule now requires:
  1. The call's parent is a `boolean_operator`
  2. The call is the LEFT operand
  3. The operator is `or`
  4. The RIGHT operand is non-falsy (otherwise there's nothing to mask)

- **`default-except-not-last`** — fixed AST traversal to accept
  `as_pattern` (from `except X as e:`) and `parenthesized_expression`
  (from `except (A, B) as e:`) as valid catch types. Pre-fix the rule
  thought `except httpx.HTTPStatusError as e:` was a bare except and
  incorrectly flagged the following specific handler.

### Phase 3 files modified

**Source:**
- `packages/analyzer/src/data-flow/known-globals.ts`
- `packages/analyzer/src/data-flow/scope-analyzer.ts`
- `packages/analyzer/src/rules/code-quality/visitors/python/magic-value-comparison.ts`
- `packages/analyzer/src/rules/bugs/visitors/python/falsy-dict-get-fallback.ts`
- `packages/analyzer/src/rules/bugs/visitors/python/default-except-not-last.ts`

**Fixtures (positive — clean code that must NOT fire):**
- `tests/fixtures/sample-python-project-positive/shared/utils/walrus_and_lambda.py`
- `tests/fixtures/sample-python-project-positive/shared/utils/tag_dispatch.py`
- `tests/fixtures/sample-python-project-positive/shared/utils/dict_get_patterns.py`
- `tests/fixtures/sample-python-project-positive/shared/utils/try_except_patterns.py`

**Fixtures (negative — real TP markers):**
- `tests/fixtures/sample-python-project-negative/services/worker/phase3_tps.py`
  — 6 real TP markers: magic-value (3), falsy-dict (2), default-except (1)
- `tests/fixtures/sample-python-project-negative/expected-graph.json` —
  added `phase3_tps` module entry

**Negative fixture markers re-categorized as SKIP** (10 cases that were
false-positive markers pre-fix, now documented as intentional skips):
- `services/notification_service/queue_processor.py` (3)
- `services/notification_service/email_sender.py` (1)
- `services/notification_service/templates.py` (1)
- `services/user_service/services/auth_service.py` (1)
- `services/worker/monitoring.py` (2)
- `services/worker/task_runner.py` (2)

**Tests updated:**
- `tests/analyzer/bugs-rules.test.ts` — 11 new Phase 3 tests
  (default-except with `as_pattern`, falsy-dict with `or` pattern,
  undefined-name with lambda/walrus/builtins/nested tuple/imports)
- `tests/analyzer/code-quality-rules.test.ts` — 9 new Phase 3 tests
  (magic-value-comparison context-aware skips + real TP fires)

---

## Phase 4 — Architecture-checker plumbing — ✅ COMPLETE

**Battle test delta:** 10,594 → 10,588 (-6 FPs). Small FP win, but the
filePath persistence fix is a significant quality improvement.

### Fixes applied

1. **filePath persistence** — `DetEntry` interface in
   `violation-pipeline.service.ts` now carries `filePath`, `lineStart`,
   `lineEnd`, `snippet` through the conversion and DB persistence.
   Pre-fix, all 267 architecture-checker violations showed
   `filePath: null` in the API. Now they all have proper file paths.

2. **Migration file skip for long-method** — Alembic `versions/` and
   Django `migrations/` directories are now skipped. `upgrade()` /
   `downgrade()` functions in auto-generated migration files are long by
   design. Result: 7 → 1 (-6). The remaining 1 is a real TP
   (`LoadFormPage.populate` in a UI automation service).

3. **Dunder method skip for dead-method** — Python `__init__`, `__str__`,
   etc. are now skipped (called by runtime, not explicitly). No impact
   on arnata-brain (none of the 18 dead-method violations were dunders).

### Deferred to post-Phase-7 investigation

Phase 4 delivered only -6 of the estimated ~207 FPs. The remaining 261
architecture violations need deeper investigation that was deferred to
AFTER Phase 5-7 are complete. The decision: finish all phases first, then
come back to investigate these 261 with the full battle-test data from
all phases.

Violations to investigate:
- `cross-service-internal-import` (157) — service-boundary detection
  needs Python-specific adjustments. Biggest chunk — sample 10-15 to
  determine FP rate before committing to a fix.
- `unused-export` (67) — needs `__all__` + `__init__.py` re-export
  awareness
- `data-layer-depends-on-external` (18) — layer classification audit
- `dead-method` (18) — methods called via socketio events, FastAPI DI,
  or dynamic dispatch patterns the checker doesn't track

---

## Phase 5 — Schema index for `missing-unique-constraint` — ⬜ NOT STARTED

**Scope:** eliminate ~195 FPs in the Python
`database/deterministic/missing-unique-constraint` visitor by wiring it
into the existing `SchemaIndex` built during JS Phase 5.

**Work needed:**
- Extend `SchemaIndex` to recognize SQLAlchemy `Mapped[...] = mapped_column(...,
  unique=True)` and `Column(..., unique=True)` patterns
- Thread the index into the Python visitor via `needsSchemaIndex`
- Extract table + column names from `session.query(Model).filter(...)` and
  `session.execute(select(...))` patterns
- Skip the visitor when the column is actually `@unique` in the schema

JS Phase 5 already built the SchemaIndex framework and hooked it into the
analyzer pipeline. Python just needs the parser extensions + visitor wiring.

---

## Phase 6 — Heuristic / detection improvements — ⬜ NOT STARTED

**Scope:** ~649 FPs in smaller per-rule heuristic fixes.

**Target rules:**
- `bugs/deterministic/datetime-without-timezone`
- `code-quality/deterministic/redundant-jump`
- `code-quality/deterministic/async-unused-async`
- `code-quality/deterministic/require-await`
- `code-quality/deterministic/missing-fstring-syntax`
- `code-quality/deterministic/try-consider-else`
- `code-quality/deterministic/logging-root-logger-call`
- `style/deterministic/import-formatting` *(blocks Phase 2 fixture re-add)*
- `code-quality/deterministic/needless-else`
- `code-quality/deterministic/magic-value-comparison` *(partial)*
- `code-quality/deterministic/typing-only-import` *(blocks Phase 2 fixture re-add)*
- `reliability/deterministic/shebang-error` *(blocks Phase 2 fixture re-add)*

**Phase 6 also re-adds two Phase 2 fixture files** that were deferred:
- `tests/fixtures/sample-python-project-positive/services/user_service/models/sqlalchemy_user.py`
- `tests/fixtures/sample-python-project-positive/scripts/cli_tool.py`

---

## Phase 7 — Long-tail cleanup — ⬜ NOT STARTED

**Scope:** ~150 remaining FPs across long-tail per-rule fixes + 4 logging
visitors that share a substring leak (single shared helper).

---

## Battle-test numbers

| Phase | Violations | Delta | Rules affected |
|---|---|---|---|
| Pre-Phase-1 baseline | **12,873** | — | 224 total |
| After Phase 1 | 12,873 | 0 | (infrastructure only) |
| After Phase 2 | 11,943 | -930 | 16 rules |
| After Phase 3 | 10,594 | -1,349 | 4 rules |
| After Phase 4 | **10,588** | **-6** | 1 rule + filePath fix |
| **Cumulative** | 10,588 | **-2,285** | 21 rules |
| Target after Phase 7 | ~8,365 | -4,508 total | 0% FP rate |

## Full test suite

- **3,286 / 3,286 passing** after Phase 4
- `python-positive.test.ts` stable (de-flaked by the Phase 2 scope-analyzer
  proxy-identity fix)
- `python-negative.test.ts` stable

## Next step

Phase 5: Schema index for Python `missing-unique-constraint` (~195 FPs).
Wire the existing `SchemaIndex` (built in JS Phase 5) into the Python
visitor.

After Phase 5-7 are all complete, return to investigate the 261 deferred
architecture violations from Phase 4.
