# Python Visitor Cleanup — Status

Multi-phase effort to eliminate false positives in the Python analyzer
visitors. Battle-tested against `arnata-brain` (693 Python files).

**Starting baseline (pre-Phase-1):** 12,873 violations across 224 rules,
~4,508 false positives (~35% FP rate) verified by parallel sampling agents.

**Current state (after Phase 2):** 11,943 violations, **-930 false positives**.

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

## Phase 3 — Scope / data-flow fixes — ⬜ NOT STARTED

**Scope:** fix ~1,244 FPs in rules that depend on scope analysis.

**Target rules:**
- `bugs/deterministic/undefined-name` (115 remaining after Phase 2 side-fix)
- `code-quality/deterministic/magic-value-comparison` (595 FPs)
- `bugs/deterministic/falsy-dict-get-fallback` (est. ~200)
- `bugs/deterministic/default-except-not-last` (est. ~50)

**Known gaps in scope analyzer:**
- Lambda parameter scoping
- Walrus operator (`:=`) binding scope
- List/dict/set comprehension variable scoping
- Forward references in type annotations
- `ContextVar` / `contextvars` pattern
- Dataclass-style forward references

The Phase 2 scope-analyzer proxy-identity fix already eliminated -5
`undefined-name` FPs; Phase 3 will tackle the remaining 115.

---

## Phase 4 — Architecture-checker plumbing — ⬜ NOT STARTED

**Scope:** fix ~207 FPs in cross-file architecture rules.

**Root cause:** same shape as the JS `fileAnalyses` null-filePath bug fixed
in JS Phase 4 — architecture rules receive `null` / missing paths for
certain files and then mismatch against the dependency graph.

**Target rules (Python side):**
- `architecture/deterministic/cross-service-internal-import`
- `architecture/deterministic/duplicate-import`
- `architecture/deterministic/data-layer-depends-on-external`
- `architecture/deterministic/long-method`
- `architecture/deterministic/dead-method`
- `architecture/deterministic/unused-export`

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
| After Phase 2 | **11,943** | **-930** | 16 rules impacted |
| Target after Phase 7 | ~8,365 | -4,508 total | 0% FP rate |

## Full test suite

- **3,263 / 3,263 passing** after Phase 2, stable across 3/3 runs
- `python-positive.test.ts` no longer flakes (de-flaked by the scope-analyzer
  proxy-identity fix)
- `python-negative.test.ts` no longer flakes

## Next step

Phase 3: scope / data-flow fixes. Start by auditing the scope analyzer for
the gaps listed in the Phase 3 section and draft a plan.
