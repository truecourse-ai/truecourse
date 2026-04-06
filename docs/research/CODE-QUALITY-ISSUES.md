# Code Quality Issues — Rule Implementation

Issues found during review of the agent-generated rule infrastructure. These need to be fixed before production release.

---

## Scope Analyzer (`packages/analyzer/src/data-flow/scope-analyzer.ts`)

1. **Global mutable `nextScopeId`** — `let nextScopeId = 0` at module level. Risk of ID collision if `buildScopeTree` is called concurrently for multiple files. Should be local to each call.

2. **Two-pass for Python** — Lines 714-765 do a full AST walk just to collect `global`/`nonlocal` declarations, then clear everything and walk again. Doubles the cost for Python files. Could be merged into a single pass.

3. **`JS_SCOPE_NODES` and `JS_FUNCTION_NODES` are identical** — Lines 44-48 and 55-58 define the same set. One should be removed.

4. **Missing `class_body` scope for JS** — Class bodies with private fields (`#field`) should create their own scope for private member tracking. Currently only `class_declaration`/`class` creates a scope.

5. **Missing `with_statement` scope for Python** — The `ScopeKind` type includes `'with'` but it's never used in the analyzer.

6. **Missing `for_statement` scope for JS** — `for (let i = 0; ...)` should create a block scope for `i`, but the logic only creates block scope for `statement_block` nodes inside for/if/while, not the for statement itself.

7. **`isTypePosition` walks full parent chain** — Potentially slow (walks to root for every identifier). May not be needed if no rule uses the `isTypePosition` flag on `UseSite`.

---

## Architecture Visitors

8. **Hardcoded framework object allowlist in `declarations-in-global-scope`** (`packages/analyzer/src/rules/architecture/visitors/python/declarations-in-global-scope.ts`) — `['logger', 'log', 'app', 'api', 'router', 'blueprint']` is incomplete and fragile. Missing `express`, `server`, `db`, `prisma`, `mongoose`, `celery`, `config`, `settings`, `fastapi`, and many more. Language-mixed (Flask + Express in one list).

---

## Bugs Visitors Helpers (`packages/analyzer/src/rules/bugs/visitors/javascript/_helpers.ts`)

9. **`JS_LANGUAGES` and `TS_LANGUAGES` duplicated across many `_helpers.ts` files** — Each domain has its own copy. Should be defined once in a shared location.

10. **`PURE_ARRAY_METHODS` includes mutating methods** — `reverse` and `sort` are NOT pure (they mutate in place). `toSorted` and `toReversed` are the pure versions. Bug: the `ignored-return-value` rule would incorrectly skip `arr.reverse()`.

11. **`VOID_RETURNING_METHODS` is incomplete and incorrect** — Includes `reverse` which returns the array (not void). Missing common void methods like `addEventListener`, `removeEventListener`, `setTimeout`, `clearTimeout`.

12. **`KNOWN_ARG_ORDERS` is inherently fragile** — Hardcoded heuristic for detecting argument order mismatches based on parameter names. Names vary widely. No better approach without type info, but should document this limitation.

13. **`READ_ONLY_GLOBALS` is incomplete** — Missing `globalThis`, `window`, `document`, `console`, `process`, `Buffer`. Also `Promise`, `Map`, etc. can technically be reassigned in non-strict mode.

14. **`LITERAL_TYPES` and `PRIMITIVE_TYPES` are nearly identical** — Lines 19 and 29 define overlapping sets. Should be consolidated into one.

15. **`THROWABLE_TYPES` includes `'object'`** — Tree-sitter's node type for `{}` is `object`, which could cause false matches where an object literal is flagged as "throwing a non-Error."

---

## Bugs Visitors Python Helpers (`packages/analyzer/src/rules/bugs/visitors/python/_helpers.ts`)

16. **`MUTABLE_DEFAULTS` mixes type names and literals** — `'list'`, `'dict'`, `'set'` are constructor calls but `'[]'` and `'{}'` are literal syntax. Different detection contexts mixed in one set.

17. **`DUNDER_PARAM_COUNTS` is incomplete** — Missing `__new__`, `__format__`, `__sizeof__`, `__reduce__`, `__getattr__`/`__setattr__`/`__delattr__`, `__aenter__`/`__aexit__`, `__await__`, `__aiter__`/`__anext__`.

18. **`VALID_OPEN_MODES` may be incomplete** — Missing deprecated `'U'` mode and some edge-case binary/text combos.

19. **`MUTATING_METHODS` includes `'del'`** — `del` is a keyword, not a method. Should be removed.

20. **`SPECIAL_METHOD_RETURN_CONSTRAINTS` uses tree-sitter node types** — `'string'`, `'integer'`, `'float'` are tree-sitter types, not Python types. Correct for AST but confusing. Should be documented.

---

## Performance Visitors JS (`packages/analyzer/src/rules/performance/visitors/javascript/_helpers.ts`)

21. **`isInsideAsyncFunctionOrHandler` reads full node `.text`** — `current.text.startsWith('async ')` reads the entire text of the function node just to check the `async` keyword. For large functions, this could be thousands of characters. Should check for an `async` keyword child node instead.

22. **`isInsideAsyncFunctionOrHandler` hardcodes Express handler detection** — Only detects `(req, res)` parameter names. Misses Koa (`ctx`), Fastify, Hapi, Next.js, and other frameworks.

23. **`LARGE_PACKAGES` is incomplete** — Only 7 packages. Missing `core-js`, `@angular/core`, `firebase`, `three`, `date-fns` (if importing all), etc.

24. **`isInsideHook` is dead code** — Defined but never called by any visitor. Should be removed.

25. **`findEnclosingFunctionNode` missing `method_definition`** — Only checks `function_declaration`, `arrow_function`, `function`. Compare with `isInsideLoop` in the same file which correctly includes `method_definition`. Will fail to find enclosing class methods.

---

## Code Quality Visitors JS (`packages/analyzer/src/rules/code-quality/visitors/javascript/_helpers.ts`)

26. **`MAGIC_NUMBER_WHITELIST` is very small** — Only 6 values (0, 1, 2, -1, 100, 1000). Most linters whitelist `10`, `24`, `60`, `360`, `1024`, `255`, `256`, etc. Will generate excessive false positives.

---

## Database Visitors JS (`packages/analyzer/src/rules/database/visitors/javascript/_helpers.ts`)

27. **`bodyHasTransactionCall` regex bug** — Applies regex to `body.text.toLowerCase()` but the regex contains `withTransaction` (camelCase). After lowercasing, the text becomes `withtransaction` which won't match the camelCase pattern. Actual bug: transaction detection silently fails for `withTransaction()` calls.

28. **`SQL_WRITE_METHODS` includes `query`** — `query` is a general-purpose method used for both reads and writes. Including it here may cause false positives in rules that target write operations.

29. **`ORM_RELATIONSHIP_ACCESSORS` mixes relationship loading with general queries** — `filter`, `get`, `all`, `first` are general ORM query methods, not specifically relationship accessors. Misleading name.

---

## Database Visitors Python (`packages/analyzer/src/rules/database/visitors/python/_helpers.ts`)

30. **`PYTHON_WRITE_METHODS` includes `filter`** — `filter()` is a read/query operation (Django's `Model.objects.filter()`), not a write. Bug: rules checking for unprotected writes would flag read-only filter queries.

31. **`PYTHON_FIND_METHODS` and `PYTHON_ORM_LAZY_METHODS` are nearly identical** — Both contain `filter`, `first`, `get`, `exists`. Should be consolidated into one set or clearly differentiated.

32. **`PYTHON_CONNECTION_METHODS` is incomplete** — Only 4 entries. Missing `create_engine`, `create_pool`, `create_async_engine` (SQLAlchemy), `aiopg.create_pool`, `asyncpg.connect`, and other async connection factory patterns.

---

## Duplicated Utilities Across Helpers

33. **`LOOP_TYPES` duplicated** — Identical `Set` defined in both `performance/visitors/javascript/_helpers.ts` and `database/visitors/javascript/_helpers.ts`.

34. **`isInsideLoop` duplicated 4×** — Same logic in `performance/javascript`, `database/javascript`, `performance/python`, `database/python`. Should be in one shared location.

35. **`isInsideTryBody` duplicated** — Near-identical implementations in `database/javascript` and `database/python` helpers.

36. **`findContainingStatement` duplicated** — Same function in `performance/javascript` and `reliability/javascript` helpers.

37. **`JS_LANGUAGES` / `TS_LANGUAGES` duplicated** — Each domain's `_helpers.ts` defines its own copy (Issue #9 above). At least 3 copies exist.

---

## LLM Rules — Context Requirements (`packages/analyzer/src/rules/*/llm.ts`)

38. **Reliability `hasCallsTo` over-matches** (`reliability/llm.ts`) — File filter includes `'post'`, `'get'`, `'request'` which are extremely common names (route handlers, Express `request`, any getter). Will match nearly every file, defeating the purpose of targeted filtering. Should use import-based filters or more specific callee names like `'axios.get'`, `'fetch'`.

39. **`callsAny` uses substring matching via `.includes()`** (`context-router.ts:139`) — `c.callee.includes(t)` means `'get'` matches `'getUser'`, `'budgetController'`, any callee containing "get". Same for `'request'`. Should use exact match or word-boundary matching.

40. **Database LLM rules have no `contextRequirement`** (`database/llm.ts`) — Both `missing-foreign-key` and `missing-index` lack context requirements entirely. They'll receive all files unfiltered, which may be intentional for schema-scanning rules but should be explicit (e.g., `tier: 'metadata'` or file filter for migration/schema files).
