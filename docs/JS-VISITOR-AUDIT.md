# JS Visitor Quality Audit

**Date:** 2026-04-10
**Scope:** All JavaScript/TypeScript visitors in `packages/analyzer/src/rules/*/visitors/javascript/`
**Method:** 8 Explore agents (one per domain) audited 542 visitor files for hardcodes, overfits to specific projects, and band-aid skip conditions accumulated during prior FP elimination cycles.

## Executive summary

| Domain | Visitors | Issues | HIGH | MED | LOW |
|---|---:|---:|---:|---:|---:|
| architecture | 12 | 16 | 9 | 5 | 2 |
| bugs | 157 | 14 | 9 | 4 | 1 |
| code-quality | 235 | 24 | 4 | 8 | 12 |
| database | 8 | 12 | 6 | 4 | 2 |
| performance | 17 | 17 | 5 | 9 | 3 |
| reliability | 18 | 23 | 2 | 19 | 2 |
| security | 88 | 17 | 6 | 8 | 3 |
| style | 7 | 8 | 1 | 2 | 5 |
| **Total** | **542** | **131** | **42** | **59** | **30** |

131 distinct issues across 542 visitors (~24% flagged). The good news: most issues collapse into 5–6 systemic anti-patterns. Fixing the patterns once with shared helpers eliminates the bulk of the findings.

## Why this audit happened

We just discovered two real bugs that had been masked by accumulated FP-cycle workarounds:

1. **`fileAnalyses` undefined parameter** in the server pipeline made `dead-method` skip conditions silently no-op. Each FP cycle added more skip conditions thinking the previous ones weren't enough. When we finally fixed the parameter, we ended up with 14 stacked skip conditions, several too broad.
2. **Broken Drizzle column extraction** in `missing-unique-constraint` returned `"where"` instead of the actual column name. Each FP cycle added more entries to a `COMMONLY_UNIQUE_FIELDS` hardcoded set to mask the symptoms. The set grew to include `'name'`, `'userId'`, `'user_id'` — entries that create false negatives in legitimate code.

The concern: if two rules accumulated workarounds this way, others probably did too. This audit hunts for the same patterns across all 542 visitors.

---

## Systemic anti-patterns

These patterns recur across every domain. Fix the pattern once and ~50 visitors improve.

### Pattern 1 — `text.includes(...)` instead of AST checks

**Why it's wrong:** Substring matching has no notion of identifiers vs. comments vs. strings vs. unrelated tokens. A rule looking for variable `id` matches `getId`, `valid`, `paid`, `// id`, `'id'`, `idle`. Causes both FPs (rule fires when it shouldn't) and FNs (skip condition triggered by an unrelated mention).

**Where it appears (non-exhaustive):**
- `architecture/missing-input-validation.ts:21-31` — detects validation libraries via `bodyText.includes('Joi.')`, `'.parse('`, etc.
- `architecture/route-without-auth-middleware.ts:27-35` — exempts entire file if `fileText.includes('authenticate')` anywhere
- `architecture/missing-rate-limiting.ts:21-27` — detects rate limiter via substring
- `security/user-input-in-path.ts:41-44` — detects `req.` via substring
- `security/user-input-in-redirect.ts:26-30` — same pattern
- `security/path-command-injection.ts:28-31` — same pattern
- `security/dynamically-constructed-template.ts:35-37` — same pattern
- `security/unverified-cross-origin-message.ts:36` — `handlerText.includes('origin')`
- `security/timing-attack-comparison.ts:23` — `sourceCode.includes('timingSafeEqual')`
- `reliability/missing-error-event-handler.ts:48` — `.on('error')` text match
- `reliability/console-error-no-context.ts:40-41` — error variable name list
- `reliability/missing-next-on-error.ts:34` — `body.text.includes('next(')`
- `reliability/promise-all-no-error-handling.ts:46` — variable name substring
- `reliability/unchecked-array-access.ts:22` — `'Record<'` text match
- `performance/json-parse-in-loop.ts:40,44,49,66,70` — variable name substring
- `performance/unbounded-array-growth.ts:35` — loop body substring
- `performance/missing-react-memo.ts:46,69,72` — JSX detection + memo wrapping check
- `performance/missing-usememo-expensive.ts:86-87` — React import detection
- `code-quality/hardcoded-port.ts:22-23` — function name substring
- `code-quality/test-inverted-arguments.ts:34-35` — `'assert'` substring
- `code-quality/unused-constructor-result.ts:14-15` — constructor name substring
- `code-quality/test-with-hardcoded-timeout.ts:10` — test file detection
- `code-quality/test-empty-file.ts:31-35` — same
- `code-quality/prefer-const.ts:35,42` — variable name substring
- `code-quality/missing-destructuring.ts:40-41` — `'as any'` substring
- `code-quality/dot-notation-enforcement.ts:47-48` — `'Record<'` substring
- `code-quality/redundant-template-expression.ts:30` — operator substring
- `bugs/element-overwrite.ts:48` — identifier substring
- `bugs/loose-boolean-expression.ts:59-60` — type string substring
- `style/whitespace-formatting.ts:16-17` — whitespace substring
- `style/sorting-style.ts:24` — name list join-and-compare
- `database/missing-unique-constraint.ts:60` — column name in line check

**Concrete example — security/user-input-in-path.ts:41-44**

```ts
// CURRENT (BAD)
const argText = firstArg.text.toLowerCase()
if (argText.includes('req.') || argText.includes('req[') ||
    argText.includes('params') || argText.includes('query') ||
    argText.includes('body') || argText.includes('userinput') ||
    argText.includes('user_input') || argText.includes('filename')) {
  return makeViolation(...)
}
```

Problems:
- `argText.includes('body')` matches `bodyParser`, `everybody`, `antibody`, `body_parser_options`, the literal string `'body'` in a default value, etc.
- `argText.includes('params')` matches `myParamsObject`, `paramsList.length`, `// extracted from params`.
- `argText.includes('query')` matches `queryBuilder`, `subQuery`, `sql.query.execute`.
- `req.body` accessed via destructuring (`const { body } = req`) is missed entirely because there's no `req.` substring.

**How it should be — AST identifier walking:**

```ts
// PROPOSED (GOOD)
import { findUserInputAccess } from './_helpers.js'

// In _helpers.ts (shared):
//
// Returns true if `node` references a known user-input source via identifier:
//  - req.body / req.params / req.query / req.headers / req.cookies
//  - request.body / request.params / ...
//  - ctx.request.body (Koa)
//  - destructured: const { body, params } = req
//  - aliased: const userBody = req.body; later use of userBody
export function findUserInputAccess(
  node: SyntaxNode,
  scope: ScopeAnalysis,
): UserInputSource | null {
  // 1. Direct member access: req.body, request.params, etc.
  if (node.type === 'member_expression') {
    const obj = node.childForFieldName('object')
    const prop = node.childForFieldName('property')
    if (!obj || !prop) return null
    const objText = obj.text
    if (REQUEST_OBJECT_NAMES.has(objText) && USER_INPUT_PROPS.has(prop.text)) {
      return { kind: 'direct', accessor: `${objText}.${prop.text}` }
    }
  }
  // 2. Identifier resolved through scope to a user-input source
  if (node.type === 'identifier') {
    const decl = scope.resolve(node.text)
    if (decl?.source === 'user-input') return { kind: 'aliased', accessor: node.text }
  }
  return null
}

// In the visitor:
const source = findUserInputAccess(firstArg, scopeAnalysis)
if (source) {
  return makeViolation(...)
}
```

This catches the destructured case AND avoids substring leaks. The shared helper means every other security/architecture rule that needs "is this argument user-controlled?" reuses the same logic.

---

### Pattern 2 — Hardcoded skip lists masking missing checks

**Why it's wrong:** A list of identifier names is a guess. It's not evidence. The rule decides "skip violation if name is on this list" without verifying the actual constraint/property/contract that the name implies.

**Distinction:** Detect-lists (`const DANGEROUS_FNS = new Set(['eval', 'Function'])` → fire if matched) are fine. Skip-lists (`const COMMONLY_UNIQUE_FIELDS = ...` → don't fire if matched) are the problem because they convert "I don't know" into "definitely safe" silently.

**Examples:**
- `database/missing-unique-constraint.ts:132-138` — `COMMONLY_UNIQUE_FIELDS` (already known, schema-index fix planned)
- `code-quality/extend-native.ts:22` — `BUILTINS = new Set(['Array','Object','String',...])`
- `code-quality/static-method-candidate.ts:68-73` — `contractMethods` (React lifecycle hardcoded)
- `code-quality/test-missing-assertion.ts:6-8` — `ASSERTION_PATTERNS = new Set(['expect','assert','should','chai'])`
- `performance/large-bundle-import.ts:15` — `LARGE_PACKAGES`
- `performance/missing-cleanup-useeffect.ts:6` — `NEEDS_CLEANUP_METHODS`
- `performance/synchronous-crypto.ts:5` — `SYNC_CRYPTO_METHODS`
- `performance/state-update-in-loop.ts:5` — `REACT_STATE_SETTERS = /^set[A-Z]/`
- `reliability/floating-promise.ts:40-41` — `ASYNC_PREFIXES = ['fetch','save','send',...]`
- `reliability/missing-error-event-handler.ts:5-8` — `EMITTER_CONSTRUCTORS`
- `reliability/express-async-no-wrapper.ts:21` — hardcoded object names `app`/`router`/`route`
- `reliability/console-error-no-context.ts:40-41` — error variable name list
- `database/orm-lazy-load-in-loop.ts:6-13` — generic method names like `load`, `get`, `first`
- `database/unvalidated-external-data.ts:6-8` — `EXTERNAL_SOURCES`
- `bugs/useeffect-missing-deps.ts:36-53` — `EXCLUDED_IDENTIFIERS` plus `/^set[A-Z]/`
- `bugs/base-to-string.ts:34-44` — hardcoded "safe types"

**Concrete example — reliability/floating-promise.ts:40-43**

```ts
// CURRENT (BAD)
// Heuristic: only flag commonly known async patterns
const ASYNC_PREFIXES = ['fetch', 'save', 'send', 'update', 'create', 'remove', 'upload', 'download', 'load']
const isLikelyAsync = ASYNC_PREFIXES.some((p) => funcName.toLowerCase().startsWith(p))

if (!isLikelyAsync) return null
```

Problems:
- Misses `request()`, `query()`, `dispatch()`, `commit()`, `flush()`, `persist()`, `submit()`, `publish()`, `enqueue()` — all common async function names.
- Falsely flags sync functions like `loadConfigSync()`, `createBullBoard()`, `removeListener()`, `updateUI()`, `sendKey()` — the rule's own comment admits this.
- Adding more prefixes makes the false-positive rate worse, removing prefixes makes the false-negative rate worse. The hardcoded list cannot win.

**How it should be — TypeScript type query:**

```ts
// PROPOSED (GOOD)
// Use TypeScript's type checker to determine if the call returns a Promise.
// This is what the analyzer's TypeQueryService is for — it wraps ts.TypeChecker.

import { typeQuery } from '../../../../services/type-query.js'

// In the visitor:
const callType = typeQuery.getReturnTypeAtNode(node, filePath)
if (!callType) {
  // No type info available — fall back to conservative skip OR
  // use a small, well-justified detect list of known-async stdlib calls
  // (NOT a guess based on prefix).
  return null
}

const isPromise = callType.symbol?.escapedName === 'Promise'
  || callType.getProperty('then')?.valueDeclaration?.kind === ts.SyntaxKind.MethodSignature

if (!isPromise) return null
// ... rest of rule
```

If type info isn't available (project doesn't compile, JS without JSDoc, etc.), the rule should either skip conservatively (no FP, accept FN) or use a clearly-justified small detect list — NOT a 9-prefix heuristic that pretends to know what's async.

---

### Pattern 3 — File-path substring matching

**Why it's wrong:** `filePath.includes('test')` matches `contestants.ts`, `pretest-utils.ts`, `latest-config.ts`. `filePath.includes('static')` matches `statistics.ts`, `database-static-init.ts`. `filePath.includes('cli.ts')` matches `cli.ts.bak`, `dcli.ts`.

**Examples:**
- `architecture/missing-request-body-size-limit.ts:10-11` — `'app.'`, `'server.'`
- `architecture/raw-error-in-response.ts:9` — `/route|controller|handler|api|server/i`
- `architecture/missing-error-status-code.ts:10` — same
- `code-quality/env-in-library-code.ts:22-31` — config path substring list
- `code-quality/test-with-hardcoded-timeout.ts:10` — test file detection
- `code-quality/disabled-test-timeout.ts:10` — same
- `code-quality/test-empty-file.ts:31-35` — same
- `reliability/process-exit-in-library.ts:18-27` — `index.`, `app.`, etc.
- `reliability/uncaught-exception-no-handler.ts:10-20` — `/packages/`, `/lib/`
- `reliability/unhandled-rejection-no-handler.ts:10-20` — same
- `reliability/missing-next-on-error.ts:11` — `/route|middleware|controller/i`
- `performance/sync-fs-in-request-handler.ts:25` — `/scripts/`, `/bin/`, `/cli/`
- `bugs/missing-error-boundary.ts:24` — Next.js route file pattern
- `bugs/function-return-type-varies.ts:54` — `/components/ui/`
- `database/missing-migration.ts:12` — `/migrat/i`

**Concrete example — code-quality/test-empty-file.ts:31-35**

```ts
// CURRENT (BAD)
const lowerPath = filePath.toLowerCase()
const isTestFile = (lowerPath.includes('.test.') || lowerPath.includes('.spec.') || lowerPath.includes('__tests__'))
if (!isTestFile) return null
```

Problems:
- `path/to/test-utils/helper.ts` includes `.test` (wait, no it doesn't — but `pretest.test.ts.bak` would match `.test.`).
- Actually the bigger issue: `/foo/__tests__/setup.ts` is a test setup file, not an actual test. Matches anyway.
- A file at `/contests/winner.test.ts` has both substrings, fine — but the matching is accidental, not by design.

**How it should be — proper path checks:**

```ts
// PROPOSED (GOOD)
import { isTestFile } from './_helpers.js'

// In _helpers.ts (shared):
const TEST_FILE_REGEX = /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[jt]sx?|__tests__\/[^/]+\.[jt]sx?)$/

export function isTestFile(filePath: string): boolean {
  return TEST_FILE_REGEX.test(filePath)
}

// In the visitor:
if (!isTestFile(filePath)) return null
```

The regex anchors on path separators and file extensions, so it only matches actual test files. The shared helper means the ~10 rules that need "is this a test file?" all use the same definition.

Same pattern applies to all the path-based checks: replace `.includes()` with `path.basename(filePath)` + exact match, or anchored regex.

---

### Pattern 4 — Framework / ORM overfit

**Why it's wrong:** Many rules silently only support one framework. The rule fires (or fails to fire) correctly for Express but produces nothing useful for Fastify/Koa/Hono. Users get inconsistent coverage with no warning.

**Examples by framework:**

| Framework assumption | Rules |
|---|---|
| **React only** | performance/missing-react-memo, performance/inline-function-in-jsx-prop, performance/inline-object-in-jsx-prop, performance/unnecessary-context-provider, code-quality/react-leaked-render, code-quality/react-readonly-props, code-quality/react-unstable-key, bugs/missing-error-boundary, bugs/useeffect-missing-deps, style/js-naming-convention (PascalCase factory skip) |
| **Next.js only** | bugs/function-return-type-varies (`/components/ui/`), bugs/missing-error-boundary (Next route file pattern), performance/missing-react-memo (Next route file pattern), style/import-formatting (`'use client'`/`'use server'` directives) |
| **Express only** | architecture/missing-helmet-middleware, architecture/route-without-auth-middleware, architecture/missing-rate-limiting, architecture/missing-input-validation, security/hidden-file-exposure, security/permissive-cors, security/session-cookie-on-static, reliability/express-async-no-wrapper, reliability/missing-next-on-error |
| **Drizzle/Prisma only** | database/missing-unique-constraint (no Sequelize/TypeORM/Mongoose) |
| **Node fetch only** | reliability/http-call-no-timeout |
| **AWS CDK only** | security/aws-unencrypted-sqs, security/aws-iam-privilege-escalation, security/s3-public-bucket-access |

**Concrete example — architecture/route-without-auth-middleware.ts**

```ts
// CURRENT (BAD)
const fileText = sourceCode
if (
  fileText.includes('authenticate') ||
  fileText.includes('authMiddleware') ||
  fileText.includes('requireAuth') ||
  fileText.includes('isAuthenticated') ||
  fileText.includes('passport.')
) {
  return null
}
```

Problems:
- Express-only — Fastify uses `preHandler`, Koa uses `ctx.state.user`, Hono uses `c.get('user')`. Rule produces zero violations on those, silently.
- Even within Express, the keyword list is incomplete — `clerk()`, `auth0Middleware`, `requireSession`, `bearerToken`, `verifyJwt`, custom JWT verifiers, etc.
- File-level skip — if any function in the file mentions one of these words (even in a comment, even in a string literal), every route in the file is exempted.

**How it should be — multi-framework + per-route check:**

```ts
// PROPOSED (GOOD)
import { detectWebFramework, getRouteMiddlewareChain } from './_helpers.js'

// In _helpers.ts (shared):

export type WebFramework = 'express' | 'fastify' | 'koa' | 'hono' | 'unknown'

export function detectWebFramework(fileAnalysis: FileAnalysis): WebFramework {
  for (const imp of fileAnalysis.imports) {
    if (imp.source === 'express') return 'express'
    if (imp.source === 'fastify') return 'fastify'
    if (imp.source === 'koa' || imp.source === '@koa/router') return 'koa'
    if (imp.source === 'hono') return 'hono'
  }
  return 'unknown'
}

// Returns middleware names attached to a specific route, framework-aware.
export function getRouteMiddlewareChain(
  routeNode: SyntaxNode,
  framework: WebFramework,
): string[] {
  switch (framework) {
    case 'express':
      // app.get('/path', mw1, mw2, handler) — middleware are args 1..n-1
      return getExpressMiddlewareArgs(routeNode)
    case 'fastify':
      // fastify.get('/path', { preHandler: [auth] }, handler)
      return getFastifyPreHandlers(routeNode)
    case 'koa':
      return getKoaMiddleware(routeNode)
    case 'hono':
      return getHonoMiddleware(routeNode)
    default:
      return []
  }
}

// In the visitor:
const framework = detectWebFramework(fileAnalysis)
if (framework === 'unknown') return null  // explicit, not silent

const middleware = getRouteMiddlewareChain(node, framework)
const hasAuth = middleware.some(name => isAuthMiddleware(name, framework))
if (!hasAuth) return makeViolation(...)
```

Now the rule:
- Works on every supported framework.
- Tells you (via `framework === 'unknown'`) when it can't analyze, instead of silently passing.
- Checks the middleware chain on the specific route, not the whole file.

---

### Pattern 5 — Stacked skip conditions accumulated across FP cycles

**Why it's wrong:** Each FP cycle added one more `if (...) return null` block to silence a specific reported case. Nobody removed the previous ones. The rule ends up with 5–10 sequential skip conditions, several overlapping or contradictory. When one of them is too broad (substring match, file-level keyword, etc.) it silently kills detection — but we can't tell because the test fixtures only test the cases the rule was patched for.

**Examples:**
- `bugs/empty-catch.ts:14-34` — three sequential skip blocks (JSON.parse + strategy chain + nested try counter)
- `bugs/async-void-function.ts:18-50` — two parallel ancestor-walk blocks for useEffect and JSX event handlers
- `code-quality/missing-usememo-expensive.ts:25-87` — six sequential skip conditions (Object.entries skip, isInsideHook, useMemo wrap check, module-level const, array size, React indicator)
- `code-quality/hardcoded-url.ts:19-49` — duplicate variable-name pattern check (lines 19-25 then again 43-49 with `varName2`)
- `reliability/missing-finally-cleanup.ts:27` — multiple createServer/connect/open exemptions
- `reliability/unchecked-array-access.ts:51-61` — stacked sibling text checks (`length`, `in`, `if`, indexText)
- `style/ts-declaration-style.ts:17-19` — three node-type variants for `extends_` clause without justification

**Concrete example — bugs/empty-catch.ts:14-34**

```ts
// CURRENT (BAD)
visit(node, filePath, sourceCode) {
  const body = node.childForFieldName('body')
  if (!body || body.namedChildCount > 0) return null

  // Skip 1: JSON.parse heuristic
  const tryNode = node.parent  // try_statement
  if (tryNode?.type === 'try_statement') {
    const tryBody = tryNode.childForFieldName('body')
    if (tryBody && /JSON\.parse\s*\(/.test(tryBody.text)) return null
  }

  // Skip 2: strategy chain pattern (count nearby try statements)
  let parent = node.parent
  let nearbyTryCount = 0
  while (parent && parent.type !== 'function_declaration' && parent.type !== 'arrow_function') {
    if (parent.type === 'try_statement') nearbyTryCount++
    parent = parent.parent
  }
  if (nearbyTryCount >= 2) return null

  // Skip 3: ... and so on
  return makeViolation(...)
}
```

Problems:
- Skip 1 is fine in concept but uses regex on text — matches `// JSON.parse` in a comment, `'JSON.parse'` in a string.
- Skip 2 (strategy chain) is a guess — "if there are multiple try blocks nearby, assume they're a strategy pattern and skip." But the rule has no idea whether they actually form a strategy. Counts nested try blocks even when unrelated.
- The two skips don't compose well. Adding a third means understanding the interaction with these two — nobody does.

**How it should be — explicit, justified skip with one path per reason:**

```ts
// PROPOSED (GOOD)
visit(node, filePath, sourceCode) {
  const body = node.childForFieldName('body')
  if (!body || body.namedChildCount > 0) return null

  const skipReason = shouldSkipEmptyCatch(node)
  if (skipReason) return null

  return makeViolation(...)
}

// Single function, each branch returns a clear reason or null.
function shouldSkipEmptyCatch(catchNode: SyntaxNode): SkipReason | null {
  const tryNode = catchNode.parent
  if (tryNode?.type !== 'try_statement') return null

  const tryBody = tryNode.childForFieldName('body')
  if (!tryBody) return null

  // Reason A: JSON.parse with intentional fallback (verified via AST, not regex)
  if (containsCallExpression(tryBody, { object: 'JSON', property: 'parse' })) {
    // The catch must also have a fallback assignment in the surrounding scope.
    // If there's no fallback, the empty catch is still wrong even with JSON.parse.
    if (hasFallbackAssignment(tryNode)) return 'json-parse-with-fallback'
  }

  // Reason B: explicit "swallow" comment
  if (hasInlineComment(catchNode, /^\s*(?:intentional|ignore|swallow)/i)) {
    return 'explicit-swallow'
  }

  // No more skips. If we got here, the empty catch is suspicious.
  return null
}
```

Each skip reason is:
- Named (visible in violation metadata if you want to track which skips fire most)
- Verified via AST, not text grep
- Independently testable (write a fixture for each reason)
- Removable without breaking other skips

The "strategy chain" skip is gone — it was a guess with no theoretical justification.

---

### Pattern 6 — Text-grep for JSX

**Why it's wrong:** JSX detection via `text.includes('<')` or `/<[A-Za-z]/` matches angle brackets in:
- Generic type parameters: `Array<string>`, `Map<K, V>`
- TypeScript type assertions: `<unknown>val`
- Comparison operators: `if (a < b)`
- String literals: `"<div>"`, regex `/^</`, comments `// <something>`

And misses JSX in:
- Imported components when only the body is checked (parent has the JSX)
- Conditional renders where JSX is in a sibling branch
- JSX inside template strings (HTML-in-JS)

**Examples:**
- `style/js-naming-convention.ts:17` — `body.text.includes('jsx') || body.text.includes('<')`
- `performance/missing-react-memo.ts:46` — `bodyText.includes('<') && bodyText.includes('>')`
- `performance/missing-usememo-expensive.ts:86-87` — `child.text.includes('react') || child.text.includes('jsx')`
- `reliability/floating-promise.ts:99` — `/<[A-Za-z]/.test(bodyText)`

**Concrete example — performance/missing-react-memo.ts:46**

```ts
// CURRENT (BAD)
const bodyText = funcNode.text
if (!bodyText.includes('<') || !bodyText.includes('>')) return null
```

Problems:
- A function `function foo<T>(arr: Array<T>): T { return arr[0] }` has `<` and `>` in TypeScript generics — passes the JSX check, then the rest of the rule fires.
- A function `function compare(a, b) { return a > b ? 1 : a < b ? -1 : 0 }` has both — passes.
- A real React component returning `<MyComponent />` from a child function passes correctly, but so does any function with comparison operators.

**How it should be — AST query for jsx_element:**

```ts
// PROPOSED (GOOD)
import { containsJsx } from './_helpers.js'

// In _helpers.ts (shared):
const JSX_NODE_TYPES = new Set([
  'jsx_element',
  'jsx_self_closing_element',
  'jsx_fragment',
  'jsx_expression',
])

export function containsJsx(node: SyntaxNode): boolean {
  if (JSX_NODE_TYPES.has(node.type)) return true
  for (const child of node.namedChildren) {
    if (containsJsx(child)) return true
  }
  return false
}

// In the visitor:
if (!containsJsx(funcNode)) return null
```

Or, if the AST has `descendantsOfType`:

```ts
if (funcNode.descendantsOfType('jsx_element').length === 0
    && funcNode.descendantsOfType('jsx_self_closing_element').length === 0) {
  return null
}
```

Either way, the check uses the actual AST node types tree-sitter produces for JSX. No false positives from generics, no false negatives from JSX inside conditionals.

---

## Recommended cross-cutting fixes

These 5 changes collapse most of the 131 issues. Order them by leverage.

### Fix A — Build a project-wide schema index

**Targets:** `database/missing-unique-constraint.ts` (+ enables future schema-aware database rules)

**What:** During the analysis pipeline, scan all FileAnalysis for schema-shaped declarations (Drizzle `pgTable`, Prisma `.prisma` files, Sequelize `.define`, TypeORM `@Entity` decorators, Mongoose `Schema`, raw SQL `CREATE TABLE`). Parse out `<table>.<column>` → `{ unique, primaryKey, type }` metadata. Pass this index to visitors via context.

**Effect:** `missing-unique-constraint` gains real ground-truth lookups instead of name guessing. `COMMONLY_UNIQUE_FIELDS` and `columnHasUniqueConstraint` (the loose-text-search function) can be deleted entirely. Rule supports all 6 ORMs cleanly.

**Cost:** Medium — requires extending visitor context with project-level data, plus schema parsers (one per ORM). The Drizzle/Prisma parsers are small; Sequelize/TypeORM/Mongoose share patterns.

### Fix B — Shared `containsIdentifier(node, name)` AST helper

**Targets:** ~50 visitors using `text.includes(identifier)` for skip or detect logic.

**What:** Add to `_helpers.ts`:

```ts
export function containsIdentifier(node: SyntaxNode, name: string): boolean {
  if (node.type === 'identifier' && node.text === name) return true
  for (const child of node.namedChildren) {
    if (containsIdentifier(child, name)) return true
  }
  return false
}

// More targeted: only checks identifiers in read positions, not declarations.
export function containsIdentifierRead(node: SyntaxNode, name: string): boolean { /* ... */ }

// Even more targeted: identifier appears in a call argument or member access object.
export function containsIdentifierAsValue(node: SyntaxNode, name: string): boolean { /* ... */ }
```

**Effect:** Replaces 50+ `text.includes()` calls with proper word-boundary identifier matching. Eliminates the substring-leak FN class entirely.

**Cost:** Low — single helper, mechanical replacement.

### Fix C — Shared `containsJsx(node)` AST helper

**Targets:** 4–6 visitors (`missing-react-memo`, `floating-promise`, `js-naming-convention`, `missing-usememo-expensive`).

**What:** See Pattern 6 above.

**Effect:** Real JSX detection. No FPs from TypeScript generics. No FNs from JSX inside conditionals.

**Cost:** Trivial.

### Fix D — Replace all `filePath.includes(...)` with anchored path checks

**Targets:** ~15 visitors using path substring matching.

**What:** Add shared helpers in `_helpers.ts`:

```ts
const TEST_FILE_REGEX = /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[jt]sx?|__tests__\/[^/]+\.[jt]sx?)$/
const ROUTE_FILE_REGEX = /(?:^|\/)(routes?|controllers?|handlers?|api)\/[^/]+\.[jt]sx?$/
const CONFIG_FILE_REGEX = /(?:^|\/)(config|env|settings)\.[jt]sx?$/

export function isTestFile(filePath: string): boolean { return TEST_FILE_REGEX.test(filePath) }
export function isRouteFile(filePath: string): boolean { return ROUTE_FILE_REGEX.test(filePath) }
export function isConfigFile(filePath: string): boolean { return CONFIG_FILE_REGEX.test(filePath) }
export function isLibraryFile(filePath: string): boolean { /* /lib/, /packages/*/src/, /node_modules/ */ }
```

**Effect:** Eliminates `contestants.ts`-matches-test-file class of FPs. Single source of truth for "what's a test file" / "what's a config file" across all rules.

**Cost:** Low — mechanical replacement.

### Fix E — Multi-framework detection helper

**Targets:** ~15 framework-overfit rules (Express-only, React-only, Next.js-only, AWS CDK-only).

**What:** Add `_helpers.ts`:

```ts
export type WebFramework = 'express' | 'fastify' | 'koa' | 'hono' | 'next' | 'unknown'
export type UiFramework = 'react' | 'vue' | 'svelte' | 'solid' | 'unknown'
export type OrmFramework = 'drizzle' | 'prisma' | 'sequelize' | 'typeorm' | 'mongoose' | 'unknown'

export function detectWebFramework(fa: FileAnalysis): WebFramework { /* check imports */ }
export function detectUiFramework(fa: FileAnalysis): UiFramework { /* check imports */ }
export function detectOrm(fa: FileAnalysis): OrmFramework { /* check imports */ }

// Per-framework normalization helpers:
export function getRouteMiddleware(node, framework): string[] { /* ... */ }
export function getRouteHandler(node, framework): SyntaxNode | null { /* ... */ }
```

Then for each framework-overfit rule, decide:
- **Option A** — extend the rule to handle all frameworks via the normalization helpers
- **Option B** — keep the rule single-framework but add explicit `if (framework !== 'express') return null` so coverage gaps are visible (and the rule's documentation says so)

**Effect:** No more silent coverage gaps. Either rules work everywhere, or they explicitly opt out.

**Cost:** Medium — each rule needs to be revisited and ported. Some (like Express auth-middleware checks) are intricate and need real framework knowledge to translate to Fastify/Koa.

### What these 5 fixes don't cover

After the cross-cutting fixes, ~30 issues remain that need individual attention. Mostly:

- Stacked skip conditions in `empty-catch`, `missing-usememo-expensive`, etc. (Pattern 5) — need rule-by-rule simplification
- Hardcoded skip lists that can't be replaced by a single helper — `floating-promise`'s `ASYNC_PREFIXES` needs type info instead, which is its own infra change
- Catch-all `try { } catch { return null }` blocks hiding parser failures — should log instead of swallow
- Always-true broken logic in `missing-rate-limiting.ts:14` — bug, needs fix
- Dead code in `bugs/variable-redeclaration.ts:25-31` — cleanup
- Duplicate code in `code-quality/hardcoded-url.ts:19-49` (same check twice with `varName2` suffix) — cleanup

---

## Per-domain detailed findings

### architecture (12 visitors, 16 issues — 9 HIGH, 5 MEDIUM, 2 LOW)

| Severity | Rule | File:Line | Type |
|---|---|---|---|
| HIGH | missing-input-validation | missing-input-validation.ts:21-31 | substring-match + hardcoded-framework |
| HIGH | missing-input-validation | missing-input-validation.ts:22 | hardcoded-framework (Joi/Yup/Zod list) |
| HIGH | route-without-auth-middleware | route-without-auth-middleware.ts:18-19 | hardcoded-framework (public path list) |
| HIGH | route-without-auth-middleware | route-without-auth-middleware.ts:27-35 | overly-broad-skip (file-level keyword) |
| HIGH | missing-request-body-size-limit | missing-request-body-size-limit.ts:10-11 | overly-broad-skip (path substring) |
| HIGH | missing-pagination-endpoint | missing-pagination-endpoint.ts:25-31 | substring-match (`findAll`, `SELECT *`) |
| HIGH | raw-error-in-response | raw-error-in-response.ts:9 | overly-broad-skip (file path regex) |
| HIGH | missing-rate-limiting | missing-rate-limiting.ts:14-18 | silent-skip + always-true logic bug |
| HIGH | missing-rate-limiting | missing-rate-limiting.ts:21-27 | substring-match |
| MEDIUM | declarations-in-global-scope | declarations-in-global-scope.ts:14 | substring-match (`'export'`) |
| MEDIUM | declarations-in-global-scope | declarations-in-global-scope.ts:24 | substring-match (`'require('`) |
| MEDIUM | missing-error-status-code | missing-error-status-code.ts:10 | overly-broad-skip (path regex) |
| MEDIUM | barrel-file-re-export-all | barrel-file-re-export-all.ts:26 | hardcoded threshold (`> 5`) |
| LOW | unused-import | unused-import.ts:47 | regex word-boundary limitation |
| LOW | type-assertion-overuse | type-assertion-overuse.ts:9-10 | silent-skip on parse failure |

**Clean visitors:** `duplicate-import.ts`, `unused-import.ts` (otherwise solid)

### bugs (157 visitors, 14 issues — 9 HIGH, 4 MEDIUM, 1 LOW)

| Severity | Rule | File:Line | Type |
|---|---|---|---|
| HIGH | loose-boolean-expression | loose-boolean-expression.ts:59-60 | type-string substring |
| HIGH | await-non-thenable | await-non-thenable.ts:32-37 | overly-broad-skip on call_expression |
| HIGH | element-overwrite | element-overwrite.ts:48 | identifier substring |
| HIGH | function-return-type-varies | function-return-type-varies.ts:54 | hardcoded `/components/ui/` skip |
| HIGH | useeffect-missing-deps | useeffect-missing-deps.ts:36-53 | EXCLUDED_IDENTIFIERS hardcoded list |
| HIGH | async-void-function | async-void-function.ts:18-50 | stacked-skips (two ancestor walks) |
| HIGH | empty-catch | empty-catch.ts:14-34 | stacked-skips + JSON.parse regex |
| HIGH | missing-error-boundary | missing-error-boundary.ts:21-24 | hardcoded React/JSX strings |
| HIGH | missing-error-boundary | missing-error-boundary.ts:24 | Next.js route file pattern |
| MEDIUM | no-inner-declarations | no-inner-declarations.ts:18-23 | undocumented hardcoded BLOCK_CONTAINERS set |
| MEDIUM | variable-redeclaration | variable-redeclaration.ts:25-31 | dead code path (violation built but not returned) |
| MEDIUM | invalid-regexp | invalid-regexp.ts:23-25 | catch-all hides non-SyntaxError exceptions |
| MEDIUM | missing-error-boundary | missing-error-boundary.ts:21 | broken React detection (sourceCode.includes) |
| LOW | base-to-string | base-to-string.ts:34-44 | hardcoded "safe types" list |

**Most of the 157 bugs visitors are clean** — only ~10 files have issues.

### code-quality (235 visitors, 24 issues — 4 HIGH, 8 MEDIUM, 12 LOW)

| Severity | Rule | File:Line | Type |
|---|---|---|---|
| HIGH | hardcoded-url | hardcoded-url.ts:40 | hardcoded API domain regex |
| HIGH | hardcoded-url | hardcoded-url.ts:43-49 | duplicate variable name check (with `varName2` suffix) |
| HIGH | missing-env-validation | missing-env-validation.ts:45-66 | line-by-line text scan instead of AST |
| HIGH | extend-native | extend-native.ts:22 | hardcoded BUILTINS set |
| MEDIUM | env-in-library-code | env-in-library-code.ts:22-31 | path substring list |
| MEDIUM | hardcoded-port | hardcoded-port.ts:22-23 | function name substring |
| MEDIUM | missing-env-validation | missing-env-validation.ts:113-126 | text-based fallback validation |
| MEDIUM | unused-constructor-result | unused-constructor-result.ts:14-15 | constructor name substring |
| MEDIUM | static-method-candidate | static-method-candidate.ts:68-73 | React lifecycle hardcoded |
| MEDIUM | test-inverted-arguments | test-inverted-arguments.ts:34-35 | confused `assert` check |
| MEDIUM | for-in-without-filter | for-in-without-filter.ts:24 | string literal `'hasOwnProperty'` match |
| MEDIUM | react-leaked-render | react-leaked-render.ts:34 | hardcoded boolean naming regex |
| MEDIUM | test-with-hardcoded-timeout | test-with-hardcoded-timeout.ts:10 | test file substring |
| MEDIUM | disabled-test-timeout | disabled-test-timeout.ts:10 | test file substring |
| MEDIUM | test-empty-file | test-empty-file.ts:31-35 | test file substring |
| LOW | prefer-const | prefer-const.ts:35,42 | identifier substring |
| LOW | magic-string | magic-string.ts:24-27 | overly-broad JSX skip |
| LOW | unnecessary-type-assertion | unnecessary-type-assertion.ts:43 | `'keyof'` text match |
| LOW | redundant-template-expression | redundant-template-expression.ts:30 | operator text match |
| LOW | missing-destructuring | missing-destructuring.ts:40-41 | `'as any'` text match |
| LOW | dot-notation-enforcement | dot-notation-enforcement.ts:47-48 | `'Record<'` text match |
| LOW | star-import | star-import.ts:21-23,34-35 | hardcoded UI lib list + JSX substring |
| LOW | test-missing-assertion | test-missing-assertion.ts:6-8 | hardcoded ASSERTION_PATTERNS |
| LOW | inferrable-types | inferrable-types.ts | conservative early return |

**~210 of the 235 code-quality visitors are clean.**

### database (8 visitors, 12 issues — 6 HIGH, 4 MEDIUM, 2 LOW)

| Severity | Rule | File:Line | Type |
|---|---|---|---|
| HIGH | missing-unique-constraint | missing-unique-constraint.ts:132-138 | COMMONLY_UNIQUE_FIELDS hardcoded set |
| HIGH | missing-unique-constraint | missing-unique-constraint.ts:60 | line.includes(columnName) substring |
| HIGH | missing-unique-constraint | missing-unique-constraint.ts:48-54 | 200-char regex window crosses unrelated statements |
| HIGH | missing-unique-constraint | missing-unique-constraint.ts:26,30 | only Prisma + Drizzle ORM support |
| HIGH | unvalidated-external-data | unvalidated-external-data.ts:24-28 | any local var named `body`/`payload`/`data` flagged |
| HIGH | missing-migration | missing-migration.ts:12 | `/migrat/i` matches `migrationUtils.ts` |
| MEDIUM | missing-unique-constraint | missing-unique-constraint.ts:72-74 | 6 overlapping regex patterns OR'd together |
| MEDIUM | missing-transaction | missing-transaction.ts:34 | text-based table name extraction |
| MEDIUM | connection-not-released | connection-not-released.ts:31 | ES 2024 `using` declaration assumption |
| MEDIUM | orm-lazy-load-in-loop | orm-lazy-load-in-loop.ts:6-13 | generic method names (`load`, `get`, `first`) |
| LOW | missing-migration | missing-migration.ts:36 | DDL regex misses comments before statement |
| LOW | unvalidated-external-data | unvalidated-external-data.ts:6-8 | EXTERNAL_SOURCES hardcoded list |

**ORM coverage matrix:**
| Visitor | Drizzle | Prisma | Sequelize | TypeORM | Mongoose | Raw SQL |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| connection-not-released | generic | generic | generic | generic | generic | n/a |
| missing-migration | n/a | n/a | n/a | n/a | n/a | partial |
| missing-transaction | generic | generic | generic | generic | generic | n/a |
| missing-unique-constraint | YES | YES | NO | NO | NO | n/a |
| orm-lazy-load-in-loop | partial | partial | partial | partial | partial | n/a |
| select-star | n/a | n/a | n/a | n/a | n/a | YES |
| unsafe-delete-without-where | n/a | n/a | n/a | n/a | n/a | YES |
| unvalidated-external-data | generic | generic | generic | generic | generic | YES |

### performance (17 visitors, 17 issues — 5 HIGH, 9 MEDIUM, 3 LOW)

| Severity | Rule | File:Line | Type |
|---|---|---|---|
| HIGH | unbounded-array-growth | unbounded-array-growth.ts:31 | `.exec(` text match |
| HIGH | unbounded-array-growth | unbounded-array-growth.ts:35 | loop body substring (`splice`, `shift`) |
| HIGH | json-parse-in-loop | json-parse-in-loop.ts:40,44,49,66,70 | variable name substring |
| HIGH | missing-react-memo | missing-react-memo.ts:46 | JSX detection via `<` and `>` |
| HIGH | missing-react-memo | missing-react-memo.ts:69,72 | memo detection via `'memo('` substring |
| MEDIUM | large-bundle-import | large-bundle-import.ts:15 | LARGE_PACKAGES hardcoded set |
| MEDIUM | missing-cleanup-useeffect | missing-cleanup-useeffect.ts:6 | NEEDS_CLEANUP_METHODS hardcoded set |
| MEDIUM | synchronous-crypto | synchronous-crypto.ts:5 | SYNC_CRYPTO_METHODS hardcoded set |
| MEDIUM | inline-function-in-jsx-prop | inline-function-in-jsx-prop.ts:28 | lowercase tag = native HTML assumption |
| MEDIUM | missing-usememo-expensive | missing-usememo-expensive.ts:86-87 | React detection via `'react'` substring |
| MEDIUM | state-update-in-loop | state-update-in-loop.ts:5 | `/^set[A-Z]/` React-only naming |
| MEDIUM | sync-fs-in-request-handler | sync-fs-in-request-handler.ts:25 | `/scripts/`, `/bin/`, `/cli/` path skip |
| MEDIUM | missing-react-memo | missing-react-memo.ts:41 | Next.js route file regex |
| MEDIUM | missing-usememo-expensive | missing-usememo-expensive.ts:25-87 | 6 stacked skip conditions |
| LOW | unnecessary-context-provider | unnecessary-context-provider.ts:28 | `'children'` substring match |
| LOW | missing-usememo-expensive | missing-usememo-expensive.ts:25 | hardcoded `entries`/`keys`/`values` skip |
| LOW | missing-usememo-expensive | missing-usememo-expensive.ts:72-73 | stacked-skips |

**Clean visitors:** `event-listener-no-remove`, `regex-in-loop`, `spread-in-reduce`, `sync-require-in-handler`, `inline-object-in-jsx-prop`, `settimeout-setinterval-no-clear`

### reliability (18 visitors, 23 issues — 2 HIGH, 19 MEDIUM, 2 LOW)

| Severity | Rule | File:Line | Type |
|---|---|---|---|
| HIGH | express-async-no-wrapper | express-async-no-wrapper.ts:21 | hardcoded object names `app`/`router`/`route` |
| HIGH | floating-promise | floating-promise.ts:40-41 | ASYNC_PREFIXES name heuristic |
| MEDIUM | http-call-no-timeout | http-call-no-timeout.ts:28 | `/components/` skip wrong assumption |
| MEDIUM | http-call-no-timeout | http-call-no-timeout.ts:32 | `'signal'` text match |
| MEDIUM | http-call-no-timeout | http-call-no-timeout.ts:39 | relative URL exemption |
| MEDIUM | http-call-no-timeout | http-call-no-timeout.ts:56 | `'timeout'` text match |
| MEDIUM | floating-promise | floating-promise.ts:75-76 | only `useEffect`/`useLayoutEffect` known |
| MEDIUM | floating-promise | floating-promise.ts:99 | JSX detection via regex |
| MEDIUM | missing-error-event-handler | missing-error-event-handler.ts:48 | `.on('error')` text match |
| MEDIUM | missing-error-event-handler | missing-error-event-handler.ts:5-8 | EMITTER_CONSTRUCTORS hardcoded |
| MEDIUM | missing-finally-cleanup | missing-finally-cleanup.ts:27 | stacked overlapping skips |
| MEDIUM | console-error-no-context | console-error-no-context.ts:40-41 | error variable name list |
| MEDIUM | missing-next-on-error | missing-next-on-error.ts:11 | path regex (`/route|middleware/`) |
| MEDIUM | missing-next-on-error | missing-next-on-error.ts:34 | `'next('` text match |
| MEDIUM | process-exit-in-library | process-exit-in-library.ts:18-27 | path substring list |
| MEDIUM | uncaught-exception-no-handler | uncaught-exception-no-handler.ts:10-20 | path substring |
| MEDIUM | unhandled-rejection-no-handler | unhandled-rejection-no-handler.ts:10-20 | path substring |
| MEDIUM | promise-all-no-error-handling | promise-all-no-error-handling.ts:46 | variable name substring |
| MEDIUM | unchecked-array-access | unchecked-array-access.ts:22 | `'Record<'` text match |
| MEDIUM | unchecked-array-access | unchecked-array-access.ts:51-61 | stacked sibling text checks |
| LOW | catch-without-error-type | catch-without-error-type.ts:20 | `'instanceof'`/`'typeof'` text |
| LOW | floating-promise | floating-promise.ts:47 | TODO comment about FP cycle |

**Clean visitors:** `catch-rethrow-no-context`, `empty-reject`, `missing-null-check-after-find`, `unchecked-optional-chain-depth`, `unsafe-json-parse`

### security (88 visitors, 17 issues — 6 HIGH, 8 MEDIUM, 3 LOW)

| Severity | Rule | File:Line | Type |
|---|---|---|---|
| HIGH | user-input-in-path | user-input-in-path.ts:41-44 | `'req.'` substring |
| HIGH | user-input-in-redirect | user-input-in-redirect.ts:26-30 | `'req.'` substring |
| HIGH | path-command-injection | path-command-injection.ts:28-31 | `'req.'` substring |
| HIGH | dynamically-constructed-template | dynamically-constructed-template.ts:35-37 | `'req.'` substring |
| HIGH | unverified-cross-origin-message | unverified-cross-origin-message.ts:36 | `'origin'` text match |
| HIGH | session-cookie-on-static | session-cookie-on-static.ts:32-34 | route path substring |
| MEDIUM | insecure-random | insecure-random.ts:32 | security keyword heuristic |
| MEDIUM | timing-attack-comparison | timing-attack-comparison.ts:23 | `'timingSafeEqual'` file scan |
| MEDIUM | aws-unencrypted-sqs | aws-unencrypted-sqs.ts:23 | `'aws-cdk'` import substring |
| MEDIUM | s3-insecure-http | s3-insecure-http.ts:43 | IPv4-only localhost check |
| MEDIUM | missing-helmet-middleware | missing-helmet-middleware.ts:24-28 | text-based helmet detection |
| MEDIUM | hidden-file-exposure | hidden-file-exposure.ts:26 | Express-only |
| MEDIUM | permissive-cors | permissive-cors.ts:21,47 | Express-only |
| MEDIUM | graphql-dos-vulnerability | graphql-dos-vulnerability.ts:25-31 | depth-limited parent walk + regex |
| LOW | s3-public-bucket-access | s3-public-bucket-access.ts:22-24 | regex.exec().split() instead of AST |
| LOW | hardcoded-password-function-arg | hardcoded-password-function-arg.ts:4 | broad function name regex |
| LOW | aws-iam-privilege-escalation | aws-iam-privilege-escalation.ts:29 | redundant condition (potentially unreachable) |

**Note:** Detect-lists like `WEAK_ALGORITHMS = new Set(['md5', 'sha1'])`, `EVAL_FUNCTIONS`, `DANGEROUS_PERMISSIONS` etc. are correct and intentional — they're how the rule identifies violations, not how it skips them.

### style (7 visitors, 8 issues — 1 HIGH, 2 MEDIUM, 5 LOW)

| Severity | Rule | File:Line | Type |
|---|---|---|---|
| HIGH | js-naming-convention | js-naming-convention.ts:17 | JSX detection via `'jsx'` and `'<'` text |
| MEDIUM | js-naming-convention | js-naming-convention.ts:19-20 | all PascalCase functions skipped as factories |
| MEDIUM | import-formatting | import-formatting.ts:36-38 | hardcoded `'use client'`/`'use server'` |
| LOW | comment-tag-formatting | comment-tag-formatting.ts:12 | hardcoded `TODO|FIXME|HACK|XXX` |
| LOW | sorting-style | sorting-style.ts:24 | join-and-compare fragility |
| LOW | ts-declaration-style | ts-declaration-style.ts:17-19 | three undocumented node-type variants |
| LOW | whitespace-formatting | whitespace-formatting.ts:16-17 | tab/space substring detection |

**Clean visitors:** `js-style-preference.ts` (and `sorting-style.ts` is mostly clean — only LOW)

---

## Recommended order of work

1. **Fix B (containsIdentifier helper)** — biggest leverage, lowest cost. Knocks out ~40 issues across all domains.
2. **Fix C (containsJsx helper)** — trivial, fixes ~6 visitors cleanly.
3. **Fix D (path helpers)** — mechanical, fixes ~15 visitors.
4. **Fix A (schema index)** — medium cost, but unblocks the missing-unique-constraint properly and replaces a known band-aid.
5. **Fix E (multi-framework helpers)** — biggest scope, do last. Each rule needs individual review.
6. **Individual remaining ~30 issues** — pick off after the cross-cutting fixes have removed the bulk.

## Notes

- This audit only covered JavaScript/TypeScript visitors. Python visitors likely have similar issues — separate audit needed.
- The audit was performed by 8 parallel Explore agents with the same prompt template, scoped per domain. Findings should be considered "leads" — each issue should be confirmed by reading the actual code before fixing, since the agents work from a single pass and may misclassify intent occasionally.
- The 131 issues are not independent — fixing one shared helper can resolve dozens.
- "Clean" visitors are not "tested" — they just don't trip the audit's pattern detectors. Some clean visitors may still have bugs that require domain knowledge to spot.
