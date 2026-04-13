# Python Visitor Quality Audit

**Date:** 2026-04-13
**Scope:** All Python visitors in `packages/analyzer/src/rules/*/visitors/python/`
**Method:** 4 Explore agents (bugs, code-quality, security, remaining 5 domains) audited 601 visitor files for hardcodes, overfits, band-aid skip conditions, and `.text` substring matching accumulated during FP elimination cycles.

## Executive summary

| Domain | Visitors | Issues | HIGH | MED | LOW |
|---|---:|---:|---:|---:|---:|
| security | 61 | 18 | 8 | 8 | 2 |
| code-quality | 255 | 21 | 3 | 17 | 1 |
| bugs | 235 | 12 | 2 | 9 | 1 |
| performance | 16 | 5 | 1 | 3 | 1 |
| reliability | 10 | 3 | 2 | 1 | 0 |
| database | 10 | 3 | 0 | 3 | 0 |
| architecture | 4 | 1 | 0 | 1 | 0 |
| style | 10 | 0 | 0 | 0 | 0 |
| **Total** | **601** | **63** | **16** | **42** | **5** |

63 distinct issues across 601 visitors (~10.5% flagged). Substantially cleaner than the JS side (24%) because most Python visitors were written during the FP cleanup phases. The issues collapse into 3 systemic anti-patterns: `.text.includes()` usage, file-path substring matching, and hardcoded skip lists.

## Why this audit happened

After reaching 0% known FP rate on arnata-brain, we want to ensure the fixes themselves are generalizable and not overfitted to one project. The JS audit (`docs/JS-VISITOR-AUDIT.md`) found 131 issues — this audit applies the same methodology to Python visitors.

---

## Systemic anti-patterns

### Pattern 1 — `.text.includes()` / regex on `.text` instead of AST checks

**Why it's wrong:** `.text` returns the raw source text of a subtree. Substring matching on it has no notion of identifiers vs. comments vs. strings vs. unrelated tokens. A check for `bodyText.includes('status')` matches `# check status later`, `status_message = ...`, `"status"`, `get_status()`.

**Where it appears (~30 files):**

| File | Line(s) | What it matches on `.text` |
|---|---|---|
| `code-quality/redeclared-assigned-name.ts` | 29, 47, 66, 74 | `rhs.text.includes(name)`, `between.text.includes(name)`, `child.text.includes(name)` |
| `code-quality/boto3-client-error.ts` | 18, 27, 35 | `bodyText.includes('boto3')`, `clauseText.includes('ClientError')`, `clauseText.startsWith('except:')` |
| `code-quality/aws-custom-polling.ts` | 27, 31 | `bodyText.includes('time.sleep')`, `bodyText.includes('status')` |
| `code-quality/fastapi-undocumented-exception.ts` | 16-17, 22, 31 | `text.includes('.get(')`, `text.includes('responses')`, `bodyText.includes('HTTPException')` |
| `code-quality/test-not-discoverable.ts` | 50 | `bodyText.includes('assert')` to detect test methods |
| `code-quality/enumerate-for-loop.ts` | 9 | `bodyText.includes('${iterName}[${counterName}]')` |
| `code-quality/django-model-form-fields.ts` | 22 | `args.text.includes('ModelForm')` |
| `code-quality/tf-variable-singleton.ts` | 35 | `d.text.includes('tf.function')` |
| `code-quality/tf-function-recursive.ts` | 15, 30 | `d.text.includes('tf.function')`, regex on bodyText for recursive calls |
| `code-quality/tf-function-global-variable.ts` | 14 | `d.text.includes('tf.function')` |
| `code-quality/empty-method-without-abstract.ts` | 10, 23 | `args?.text.includes('ABC')`, `child.text.includes('abstractmethod')` |
| `code-quality/abstract-class-without-abstract-method.ts` | 12, 21, 35 | `text.includes('abstractmethod')`, `text.includes('ABC')` |
| `code-quality/pyupgrade-modernization.ts` | 58-59 | `kw.text.includes('PIPE')` |
| `code-quality/future-annotations-import.ts` | 42 | `returnType.text.includes('|')` |
| `code-quality/pytest-suboptimal-pattern.ts` | 41, 51 | `decoratorText.includes('yield_fixture')` |
| `bugs/flask-class-view-decorator-wrong.ts` | 12, 21 | `text.includes('MethodView')`, `child.text.includes('route')` |
| `bugs/trio-sync-call.ts` | 51, 55 | `child.text.includes('trio')` |
| `bugs/implicit-classvar-in-dataclass.ts` | 26, 53 | `d.text.includes('dataclass')` |
| `bugs/post-init-default.ts` | 40, 58 | `d.text.includes('dataclass')` |
| `bugs/pytest-fixture-misuse.ts` | 26, 43, 64 | `text.includes('pytest.fixture')` |
| `bugs/fastapi-204-with-body.ts` | 9, 15, 37 | `text.includes('status_code=204')`, regex on text |
| `bugs/dict-index-missing-items.ts` | 36-37 | Regex on bodyText for `self.\w+[` patterns |
| `security/insecure-random.ts` | 27-31 | `parentText.includes('token')`, `parentText.includes('secret')` etc. |
| `security/unsafe-yaml-load.ts` | 40-41 | `loaderText.includes('SafeLoader')` |
| `security/unsafe-unzip.ts` | 23-25 | `fullText.includes('zip')`, `fullText.includes('tar')` |
| `security/paramiko-call.ts` | 22, 34-35 | `nodeText.includes('paramiko')`, `parent.text.includes('AutoAddPolicy')` |
| `security/ssl-version-unsafe.ts` | 19 | `val.includes('TLSv1_1')` |
| `security/aws-public-api.ts` | 27 | Regex `/authorization_type.*NONE/i.test(nodeText)` |
| `security/aws-s3-no-versioning.ts` | 27-28 | Regex on nodeText for versioning config |
| `security/aws-unencrypted-opensearch.ts` | 24 | Regex for encryption config |
| `security/aws-iam-overly-broad-policy.ts` | 32 | `valText.includes('"*"')` |
| `security/fastapi-file-upload-body.ts` | 15, 18 | Regex for UploadFile, size validation |
| `reliability/flask-error-handler-missing-status.ts` | 31, 38, 40 | `bodyText.includes('return')`, `retText.includes(',')` |
| `performance/incorrect-dict-iterator.ts` | 36 | `bodyText.includes('${dictName}[${iterVar}]')` |
| `performance/missing-slots-in-subclass.ts` | 18, 24, 31 | `bodyText.includes('__slots__')`, `bodyText.includes('self.')`, regex on sourceCode |

**Concrete example — code-quality/redeclared-assigned-name.ts:29,47,66,74**

```ts
// CURRENT (BAD)
// Check if variable is used between two assignments
const rhs = expr.childForFieldName('right')
if (rhs && rhs.text.includes(name)) {
  // "Sequential transform" — skip
  continue
}
// ...
for (let j = prevIdx + 1; j < i; j++) {
  const between = children[j]
  if (between.text.includes(name)) {
    usedBetween = true
    break
  }
}
```

Problems:
- If `name` is `"i"`, then `between.text.includes("i")` matches `list`, `print`, `if`, `item`, `write` — virtually any statement.
- If `name` is `"x"`, it matches `exec`, `exit`, `export`, `except`, `max`, `next`, `extra`.
- `rhs.text.includes(name)` for `name = "d"` matches `data = load()` as a "transform of d".

**How it should be — AST identifier resolution:**

```ts
// PROPOSED (GOOD)
function isNameReferencedInNode(name: string, node: SyntaxNode): boolean {
  // Walk descendant identifiers and check for exact match
  const cursor = node.walk()
  let reachable = cursor.gotoFirstChild()
  while (reachable) {
    if (cursor.nodeType === 'identifier' && cursor.nodeText === name) return true
    reachable = cursor.gotoNextSibling() || (cursor.gotoParent() && cursor.gotoNextSibling())
  }
  return false
}
```

This only matches actual identifier tokens named exactly `name`, ignoring comments, strings, and partial matches inside other identifiers.

---

### Pattern 2 — File-path substring matching

**Why it's wrong:** `filePath.includes('test')` matches `contestants.py`, `pretest_utils.py`. `filePath.includes('app.')` matches `application.py`, `happy.py`. `filePath.includes('scripts/')` matches `my_scripts/helper.py` (if that's a library module inside a package called `my_scripts`).

**Where it appears (~8 files):**

| File | Line(s) | What it checks |
|---|---|---|
| `code-quality/assert-in-production.ts` | 14-16 | `fileName.includes('test_')`, `/\btest(s\|ing)?\b/.test(dirName)` |
| `code-quality/print-statement-in-production.ts` | 63-75 | `dirName === 'scripts'`, `'bin'`, `'tools'`, `'cli'`, `'cmd'` |
| `code-quality/print.ts` | 56-60 | Same directory list |
| `code-quality/logging-root-logger-call.ts` | 47-50 | Same directory list |
| `code-quality/test-not-discoverable.ts` | 24-26 | `filePath.includes('/test')` |
| `reliability/process-exit-in-library.ts` | 26-34 | `lowerPath.includes('__main__')`, `'scripts/'`, `'manage.'`, `'app.'` |
| `reliability/shebang-error.ts` | 10-11 | `filePath.includes('bin/')`, `filePath.includes('scripts/')` |
| `database/missing-migration.ts` | 10 | `/migrat/i.test(filePath)` |

**Concrete example — reliability/process-exit-in-library.ts:26-34**

```ts
// CURRENT (BAD)
const lowerPath = filePath.toLowerCase()
if (
  lowerPath.includes('__main__') ||
  lowerPath.includes('main.') ||
  lowerPath.includes('cli.') ||
  lowerPath.includes('scripts/') ||
  lowerPath.includes('manage.') ||
  lowerPath.includes('app.')
) {
  return null
}
```

Problems:
- `lowerPath.includes('app.')` matches `approval.py`, `happy.py`, `application.py`, `webapp.config.py`
- `lowerPath.includes('cli.')` matches `classifier.py`, `clicking.py`
- `lowerPath.includes('main.')` matches `maintained.py`, `domain.py`
- `lowerPath.includes('scripts/')` matches library code in a package directory that happens to be called `scripts`
- Even the `__main__` check misses guarded calls: `if __name__ == "__main__": sys.exit(main())` in any file

**How it should be — check for `__main__` guard in AST + basename matching:**

```ts
// PROPOSED (GOOD)
import { isScriptLikeFile } from '../../../_shared/python-helpers.js'

// In python-helpers.ts (shared):
export function isScriptLikeFile(filePath: string, rootNode: SyntaxNode): boolean {
  // 1. Check basename (not path substring)
  const basename = path.basename(filePath, '.py')
  if (basename === '__main__' || basename === 'manage') return true

  // 2. Check for if __name__ == "__main__" guard at module level
  for (const child of rootNode.namedChildren) {
    if (child.type === 'if_statement') {
      const condition = child.childForFieldName('condition')
      if (condition?.text.includes('__name__') && condition?.text.includes('__main__')) {
        return true
      }
    }
  }
  return false
}
```

Note: `isScriptLikeFile()` already exists in `print-statement-in-production.ts` and `print.ts` but it duplicates with the manual directory-name checks below it. It should be shared and be the single source of truth.

---

### Pattern 3 — Hardcoded skip/detect lists

**Why it's wrong:** A set of identifier names used to suppress violations is a guess, not evidence. It converts "I don't know the type" into "definitely safe" silently. The list requires manual maintenance and never covers all cases.

**Distinction from JS audit:** The Python visitors have fewer skip-lists than JS because many were gated behind proper framework detection (e.g., `detectPythonOrm()`, `importsAwsSdk()`). The remaining ones are still problematic.

**Where it appears (~8 files):**

| File | Line(s) | List | Purpose |
|---|---|---|---|
| `database/orm-lazy-load-in-loop.ts` | 11-18 | `JSONB_COLUMN_NAMES` (30+ entries) | Skip attribute access on presumed JSONB columns |
| `security/eval-usage.ts` | 11-13 | `SAFE_METHOD_RECEIVERS` (9 entries) | Skip `.eval()/.compile()` on known safe objects |
| `code-quality/boolean-trap.ts` | 23, 26, 29 | Built-in + framework function names | Skip `print()`, `sorted()`, `getattr()`, `Field()` |
| `performance/batch-writes-in-loop.ts` | 11-14, 22 | `ORM_RECEIVER_NAMES`, `ORM_WRITE_METHODS` | Detect ORM writes in loops |
| `bugs/import-self.ts` | 38, 61 | Path component markers | `['site-packages', 'src', 'lib', 'venv', '.venv', 'node_modules']` |
| `database/missing-unique-constraint.ts` | 202 | PK name regex | `/^(id|pk|_id|uuid)$/` to skip primary keys |
| `security/confidential-info-logging.ts` | 4-5 | `PYTHON_LOG_METHODS` | Fixed set of logging method names |
| `bugs/sklearn-pipeline-invalid-params.ts` | 57 | Common sklearn step names | 20+ abbreviated ML model names |

**Concrete example — database/orm-lazy-load-in-loop.ts:11-18**

```ts
// CURRENT (PROBLEMATIC)
const JSONB_COLUMN_NAMES = new Set([
  'metrics', 'metadata', 'meta', 'content', 'payload', 'data', 'config',
  'configuration', 'settings', 'options', 'params', 'parameters', 'context',
  'extra', 'extras', 'attributes', 'attrs', 'properties', 'props', 'info',
  'details', 'tags', 'labels', 'annotations', 'headers', 'body', 'json',
  'result', 'results', 'response', 'request', 'state', 'status', 'errors',
  'evaluation_details', 'raw_data', 'field_data', 'form_data', 'query_params',
])
```

Problems:
- `'data'` — virtually any attribute could be named `data`. A relationship named `data` won't be flagged.
- `'result'`, `'response'`, `'request'` — these are extremely common attribute names that may well be ORM relationships.
- `'evaluation_details'`, `'raw_data'`, `'field_data'`, `'form_data'`, `'query_params'` — these look like they were added to suppress specific arnata-brain FPs (battle-test overfit).
- The list only grows — nobody removes entries. A column named `metadata` that IS a lazy relationship will be silently skipped.

**How it should be:** This is hard to fix without type information (Pyright LSP). Short-term, the list should at minimum be documented as "known JSONB convention names" and the battle-test-specific entries (`evaluation_details`, `raw_data`, `field_data`, `form_data`, `query_params`) should be removed since they're project-specific.

---

## Per-domain detailed findings

### Security (61 visitors, 18 issues)

| # | Severity | File | Issue |
|---|---|---|---|
| 1 | HIGH | `aws-public-api.ts` | Regex on full nodeText for `authorization_type.*NONE` |
| 2 | HIGH | `aws-iam-overly-broad-policy.ts` | `valText.includes('"*"')` — context-insensitive |
| 3 | HIGH | `aws-s3-no-versioning.ts` | Regex on nodeText for versioning config |
| 4 | HIGH | `aws-unencrypted-opensearch.ts` | Regex on nodeText for encryption config |
| 5 | HIGH | `insecure-random.ts` | `parentText.includes('token')` etc. walking up parents |
| 6 | HIGH | `paramiko-call.ts` | `nodeText.includes('paramiko')` + parent text walk |
| 7 | HIGH | `unsafe-unzip.ts` | `fullText.includes('zip')` to infer ZipFile type |
| 8 | HIGH | `ssl-version-unsafe.ts` | `val.includes('TLSv1_1')` for protocol detection |
| 9 | MED | `aws-unrestricted-admin-access.ts` | Port/CIDR regex on text |
| 10 | MED | `aws-unrestricted-outbound.ts` | `nodeText.includes('ALL_TRAFFIC')` + regex |
| 11 | MED | `eval-usage.ts` | `SAFE_METHOD_RECEIVERS` hardcoded list (9 entries) |
| 12 | MED | `fastapi-file-upload-body.ts` | Regex for UploadFile + size validation |
| 13 | MED | `ssl-no-version.ts` | `firstArg.text.includes('PROTOCOL_TLS')` |
| 14 | MED | `unsafe-yaml-load.ts` | `loaderText.includes('SafeLoader')` |
| 15 | MED | `xml-xxe.ts` | `objectName.includes('ElementTree')` |
| 16 | MED | `confidential-info-logging.ts` | `PYTHON_LOG_METHODS` hardcoded set |
| 17 | LOW | `process-with-partial-path.ts` | Hardcoded `!cmd.startsWith('python')` skip |
| 18 | LOW | `s3-insecure-http.ts` | Hardcoded localhost/127.0.0.1 skip |

### Code-quality (255 visitors, 21 issues)

| # | Severity | File | Issue |
|---|---|---|---|
| 1 | HIGH | `boto3-client-error.ts` | `bodyText.includes('boto3')` + `clauseText.includes('ClientError')` |
| 2 | HIGH | `redeclared-assigned-name.ts` | `.text.includes(name)` for short variable names |
| 3 | HIGH | `assert-in-production.ts` | `/\btest(s\|ing)?\b/` path regex too broad |
| 4 | MED | `aws-custom-polling.ts` | `bodyText.includes('time.sleep')`, `bodyText.includes('status')` |
| 5 | MED | `print-statement-in-production.ts` | Hardcoded directory list + duplicates isScriptLikeFile |
| 6 | MED | `print.ts` | Same directory list duplication |
| 7 | MED | `logging-root-logger-call.ts` | Same directory list |
| 8 | MED | `test-not-discoverable.ts` | `filePath.includes('/test')` + `bodyText.includes('assert')` |
| 9 | MED | `boolean-trap.ts` | Hardcoded built-in skip lists |
| 10 | MED | `fastapi-undocumented-exception.ts` | `text.includes('.get(')` for decorator detection |
| 11 | MED | `django-model-form-fields.ts` | `args.text.includes('ModelForm')` |
| 12 | MED | `tf-variable-singleton.ts` | `d.text.includes('tf.function')` |
| 13 | MED | `tf-function-recursive.ts` | `d.text.includes('tf.function')` + regex for recursive calls |
| 14 | MED | `tf-function-global-variable.ts` | `d.text.includes('tf.function')` |
| 15 | MED | `empty-method-without-abstract.ts` | `text.includes('ABC')`, `text.includes('abstractmethod')` |
| 16 | MED | `abstract-class-without-abstract-method.ts` | Same ABC/abstractmethod text matching |
| 17 | MED | `pyupgrade-modernization.ts` | `kw.text.includes('PIPE')` |
| 18 | MED | `enumerate-for-loop.ts` | `.text.includes()` + incomplete `findCounterInit()` stub |
| 19 | MED | `future-annotations-import.ts` | `returnType.text.includes('\|')` |
| 20 | MED | `pytest-suboptimal-pattern.ts` | `decoratorText.includes('yield_fixture')` |
| 21 | LOW | `deeply-nested-fstring.ts` | `text.startsWith('f"')` logic error (AND vs OR) |

### Bugs (235 visitors, 12 issues)

| # | Severity | File | Issue |
|---|---|---|---|
| 1 | HIGH | `pytest-assert-always-false.ts` | `filePath.includes('test')` for test-file gating |
| 2 | HIGH | `function-call-in-default-arg.ts` | Comment references "arnata-brain's FastAPI routes" (actual fix is proper via `isFastApiDependsCall`) |
| 3 | MED | `flask-class-view-decorator-wrong.ts` | `text.includes('MethodView')`, `text.includes('View')` |
| 4 | MED | `trio-sync-call.ts` | `child.text.includes('trio')` instead of `getPythonImportSources()` |
| 5 | MED | `implicit-classvar-in-dataclass.ts` | `d.text.includes('dataclass')` |
| 6 | MED | `post-init-default.ts` | `d.text.includes('dataclass')` |
| 7 | MED | `pytest-fixture-misuse.ts` | `text.includes('pytest.fixture')` |
| 8 | MED | `fastapi-204-with-body.ts` | `text.includes('status_code=204')` + regex on text |
| 9 | MED | `dict-index-missing-items.ts` | Regex on bodyText for `self.\w+[` patterns |
| 10 | MED | `import-self.ts` | Hardcoded path markers including `'node_modules'` |
| 11 | MED | `sklearn-pipeline-invalid-params.ts` | Hardcoded set of 20+ sklearn step names |
| 12 | LOW | `function-call-in-default-arg.ts` | Battle-test reference in comment (non-functional) |

### Performance (16 visitors, 5 issues)

| # | Severity | File | Issue |
|---|---|---|---|
| 1 | HIGH | `incorrect-dict-iterator.ts` | `bodyText.includes('${dictName}[${iterVar}]')` |
| 2 | MED | `batch-writes-in-loop.ts` | `ORM_RECEIVER_NAMES` and `ORM_WRITE_METHODS` hardcoded |
| 3 | MED | `missing-slots-in-subclass.ts` | `bodyText.includes('__slots__')` + regex on sourceCode |
| 4 | MED | `quadratic-list-summation.ts` | `right.text.startsWith('str(')` — misses non-string `+=` |
| 5 | LOW | `torch-dataloader-num-workers.ts` | Always flags missing num_workers even for debugging |

### Reliability (10 visitors, 3 issues)

| # | Severity | File | Issue |
|---|---|---|---|
| 1 | HIGH | `process-exit-in-library.ts` | `lowerPath.includes('app.')` matches application.py etc. |
| 2 | HIGH | `flask-error-handler-missing-status.ts` | `retText.includes(',')` FPs on f-strings with commas |
| 3 | MED | `shebang-error.ts` | `filePath.includes('bin/')` / `'scripts/'` only |

### Database (10 visitors, 3 issues)

| # | Severity | File | Issue |
|---|---|---|---|
| 1 | MED | `orm-lazy-load-in-loop.ts` | 30+ entry `JSONB_COLUMN_NAMES` skip list |
| 2 | MED | `missing-unique-constraint.ts` | Hardcoded PK regex `/^(id\|pk\|_id\|uuid)$/` |
| 3 | MED | `missing-migration.ts` | `/migrat/i.test(filePath)` matches non-migration files |

### Architecture (4 visitors, 1 issue)

| # | Severity | File | Issue |
|---|---|---|---|
| 1 | MED | `unused-import.ts` | Regex word-boundary search + overly broad `# noqa` skip |

### Style (10 visitors, 0 issues)

Clean — proper AST analysis throughout.

---

## Battle-test overfits

One explicit reference to the arnata-brain project was found:

- **`bugs/function-call-in-default-arg.ts:24`** — Comment says: *"Pre-fix this rule generated ~150 FPs on arnata-brain's FastAPI routes."* The actual fix (`isFastApiDependsCall()`) is correct and generalizable. The comment is just context — LOW severity.

- **`database/orm-lazy-load-in-loop.ts:11-18`** — The `JSONB_COLUMN_NAMES` set contains entries like `evaluation_details`, `raw_data`, `field_data`, `form_data`, `query_params` that appear to be arnata-brain-specific column names added during FP cycles. These should be removed.

---

## Recommendations

### Priority 1 — Replace `.text.includes()` with AST walking (30+ files)

Create a shared helper:

```ts
// In _shared/python-helpers.ts:
export function containsIdentifier(node: SyntaxNode, name: string): boolean {
  if (node.type === 'identifier' && node.text === name) return true
  for (const child of node.namedChildren) {
    if (containsIdentifier(child, name)) return true
  }
  return false
}

export function containsCallTo(node: SyntaxNode, funcName: string): boolean {
  // Walk for call nodes where function identifier matches
}

export function getDecoratorName(decoratorNode: SyntaxNode): string {
  // Parse decorator AST: @name, @obj.name, @name(...) → just the name
}
```

Then migrate all `.text.includes()` patterns to use these helpers.

### Priority 2 — Centralize file-classification helpers (~8 files)

`isScriptLikeFile()` is already implemented but duplicated. Move it to `_shared/python-helpers.ts`, make it AST-aware (check for `__main__` guard, not just directory names), and replace all 8 file-path checks.

### Priority 3 — Audit and trim hardcoded skip lists (~8 files)

- Remove project-specific entries from `JSONB_COLUMN_NAMES`
- Document remaining entries with clear justification
- For `SAFE_METHOD_RECEIVERS` in eval-usage.ts: check import source instead of guessing from receiver name

### Priority 4 — Fix `redeclared-assigned-name.ts` (HIGH)

This is the highest-impact single fix. Short variable names (`i`, `x`, `d`, `n`) cause `.text.includes()` to match virtually any statement, leading to both FPs and FNs. Switching to AST identifier walking fixes this completely.

---

## Comparison with JS audit

| Metric | JS | Python |
|---|---|---|
| Total visitors | 542 | 601 |
| Issues found | 131 (24%) | 63 (10.5%) |
| HIGH severity | 42 | 16 |
| Dominant anti-pattern | `.includes()` on text | `.includes()` on text |
| Framework overfit severity | HIGH (Express-only) | LOW (most rules use `detectPythonOrm`/`importsAwsSdk`) |
| Hardcoded skip lists | Extensive | Moderate |
| Battle-test overfits | Not checked | 2 found |

Python visitors are cleaner overall because they were written more recently with shared framework-detection helpers available from the start. The remaining issues are concentrated in the `.text.includes()` pattern which affects ~30 visitors.
