# Rule Categorization Audit

> Audit of ALL-RULES.md for miscategorized rules across the 8 domains.
> Generated: 2026-04-04

Domain definitions used:
- **security** -- vulnerabilities, injection, crypto, auth, secrets
- **bugs** -- code that will crash, produce wrong results, or behave unexpectedly at runtime
- **architecture** -- service boundaries, module structure, layers, coupling, dead code at module level
- **code-quality** -- complexity, maintainability, code smells that make code harder to understand/maintain
- **style** -- formatting, naming conventions, docstrings, syntax preferences
- **performance** -- slow patterns, memory leaks, unnecessary computation
- **reliability** -- error handling, resource cleanup, resilience patterns
- **database** -- schema design, query patterns, ORM usage

---

## 1. code-quality -> style

Rules currently in code-quality that are syntax/formatting preferences ("prefer X over Y") rather than actual quality/maintainability issues.

| Rule | Name | Why it should move |
|------|------|--------------------|
| code-quality/deterministic/prefer-template | String concatenation over template | Pure syntax preference -- template vs concatenation does not affect quality |
| code-quality/deterministic/prefer-spread | Apply instead of spread | Syntax preference for `.apply()` vs spread operator |
| code-quality/deterministic/prefer-object-spread | Object.assign instead of spread | Syntax preference for Object.assign vs spread |
| code-quality/deterministic/prefer-rest-params | Arguments object usage | Syntax preference -- `arguments` vs rest params |
| code-quality/deterministic/prefer-const | Reassignment-free let | `let` vs `const` is a style/convention choice |
| code-quality/deterministic/prefer-while | For loop as while | Syntax preference for `for(;;)` vs `while` |
| code-quality/deterministic/prefer-immediate-return | Unnecessary temporary variable | Stylistic -- temp variable before return is a minor style choice |
| code-quality/deterministic/prefer-single-boolean-return | Wrapping boolean in if-else | Syntax preference -- `if (x) return true; else return false;` vs `return x;` |
| code-quality/deterministic/strict-equality | Loose equality | `==` vs `===` is a style/convention decision (JS community convention) |
| code-quality/deterministic/prefer-includes | indexOf for existence check | API preference -- indexOf vs includes |
| code-quality/deterministic/prefer-optional-chain | Chained logical and | Syntax preference -- `&&` chains vs `?.` |
| code-quality/deterministic/prefer-nullish-coalescing | Logical or for default | Syntax preference -- `\|\|` vs `??` |
| code-quality/deterministic/literal-assertion-over-const | Literal assertion over const | `as const` vs literal assertion is a TS syntax preference |
| code-quality/deterministic/indexed-loop-over-for-of | Indexed loop over for-of | Syntax preference -- for-of vs indexed for |
| code-quality/deterministic/interface-over-function-type | Interface over function type | TS syntax preference |
| code-quality/deterministic/filter-first-over-find | Filter first over find | API preference -- filter()[0] vs find() |
| code-quality/deterministic/substring-over-starts-ends | Substring over starts ends | API preference -- substring check vs startsWith/endsWith |
| code-quality/deterministic/this-aliasing | This aliasing | Style preference -- `const self = this` vs arrow functions |
| code-quality/deterministic/require-import | Require import | Style preference -- require() vs import |
| code-quality/deterministic/namespace-usage | Namespace usage | TS style preference -- namespace vs ES modules |
| code-quality/deterministic/triple-slash-reference | Triple slash reference | TS style preference -- /// vs import |
| code-quality/deterministic/no-proto | \_\_proto\_\_ usage | API preference -- `__proto__` vs Object.getPrototypeOf |
| code-quality/deterministic/no-iterator | \_\_iterator\_\_ usage | Style/convention preference |
| code-quality/deterministic/class-prototype-assignment | Prototype assignment in class | Syntax preference |
| code-quality/deterministic/useless-rename | Useless rename | Formatting/style cleanup |
| code-quality/deterministic/useless-computed-key | Useless computed key | Style cleanup |
| code-quality/deterministic/redundant-boolean | Redundant boolean literal | Style simplification |
| code-quality/deterministic/implicit-type-coercion | Implicit type coercion | Style preference -- !!val vs Boolean(val) |
| code-quality/deterministic/no-void | Void operator usage | Syntax preference |
| code-quality/deterministic/collapsible-else-if | Collapsible else-if | Style preference |
| code-quality/deterministic/negated-condition | Negated condition | Style preference for readability |
| code-quality/deterministic/verbose-object-constructor | Verbose object constructor | Syntax preference -- `new Object()` vs `{}` |
| code-quality/deterministic/unnecessary-else-after-return | Unnecessary else after return | Style preference |
| code-quality/deterministic/trivial-ternary | Trivial ternary | Style simplification |
| code-quality/deterministic/legacy-has-own-property | Legacy hasOwnProperty | API preference |
| code-quality/deterministic/missing-destructuring | Missing destructuring | Syntax preference |
| code-quality/deterministic/prefer-object-literal | Prefer object literal | Syntax preference |
| code-quality/deterministic/array-constructor | Array constructor | Syntax preference -- `new Array()` vs `[]` |
| code-quality/deterministic/redundant-template-expression | Redundant template expression | Style cleanup |
| code-quality/deterministic/var-declaration | var declaration | Style/convention -- var vs let/const |
| code-quality/deterministic/mixed-type-imports | Mixed type imports | TS style preference |
| code-quality/deterministic/mixed-type-exports | Mixed type exports | TS style preference |
| code-quality/deterministic/inferrable-types | Inferrable type annotations | Style preference |
| code-quality/deterministic/unnecessary-type-assertion | Unnecessary type assertion | Style cleanup |
| code-quality/deterministic/unnecessary-boolean-compare | Unnecessary boolean comparison | Style simplification |
| code-quality/deterministic/redundant-type-alias | Redundant type alias | Style cleanup |
| code-quality/deterministic/redundant-optional | Redundant optional | Style cleanup |
| code-quality/deterministic/redundant-type-constraint | Redundant type constraint | Style cleanup |
| code-quality/deterministic/useless-empty-export | Useless empty export | Style cleanup |
| code-quality/deterministic/ungrouped-shorthand-properties | Ungrouped shorthand properties | Style/ordering preference |
| code-quality/deterministic/useless-constructor | Useless constructor | Style cleanup -- empty constructor |
| code-quality/deterministic/useless-escape | Useless escape | Style cleanup |

**Note:** This is a large group. Many of these are borderline. The distinction is: does the rule catch something that makes the code harder to maintain (code-quality), or is it purely a "prefer this syntax" issue (style)? I recommend moving only the clearest cases -- rules where both forms are equally readable/maintainable and the choice is pure convention. Rules like `prefer-const`, `strict-equality`, `var-declaration`, and `prefer-nullish-coalescing` have legitimate quality arguments (they prevent classes of bugs), so you may choose to keep them in code-quality.

**Strong candidates to move (pure syntax preferences):**
- prefer-template, prefer-spread, prefer-object-spread, prefer-rest-params, prefer-while, prefer-immediate-return, prefer-single-boolean-return, literal-assertion-over-const, indexed-loop-over-for-of, interface-over-function-type, substring-over-starts-ends, this-aliasing, require-import, namespace-usage, triple-slash-reference, no-proto, no-iterator, class-prototype-assignment, useless-rename, useless-computed-key, collapsible-else-if, negated-condition, verbose-object-constructor, unnecessary-else-after-return, trivial-ternary, legacy-has-own-property, missing-destructuring, prefer-object-literal, array-constructor, mixed-type-imports, mixed-type-exports, inferrable-types, ungrouped-shorthand-properties

**Borderline (could stay in code-quality):**
- strict-equality, prefer-const, var-declaration, prefer-nullish-coalescing, prefer-optional-chain, prefer-includes, filter-first-over-find, redundant-boolean, implicit-type-coercion

---

## 2. code-quality -> bugs

Rules in code-quality that actually detect likely runtime bugs, not just quality/maintenance issues.

| Rule | Name | Why it should move |
|------|------|--------------------|
| code-quality/deterministic/empty-catch | Empty catch block | Swallowing errors silently causes bugs to go undetected -- this is a reliability/bugs issue, not just quality |
| code-quality/deterministic/missing-env-validation | Environment variable used without validation | `process.env.X` without check -- undefined at runtime causes crashes. This is a bug. |
| code-quality/deterministic/dev-dependency-in-production | Dev dependency imported in production code | Missing in production install -- runtime crash. This is a bug. |
| code-quality/deterministic/multiline-block-without-braces | Multiline block without braces | Indented statements not in braces -- the second statement always executes. Classic bug source. |
| code-quality/deterministic/implicit-global | Implicit global variable | Accidentally creating globals is a runtime bug source |
| code-quality/deterministic/function-in-loop | Function defined in loop | In Python, closure captures loop variable by reference -- actual bug, not just quality |
| code-quality/deterministic/implicit-string-concatenation | Implicit string concatenation in collection | Missing comma in list -- actual bug where `["a" "b"]` becomes `["ab"]` |
| code-quality/deterministic/cached-instance-method | Cached instance method | @lru_cache on instance method caches self -- memory leak and incorrect behavior. This is a bug. |
| code-quality/deterministic/system-exit-not-reraised | SystemExit not re-raised | Prevents clean process shutdown -- reliability/bugs issue |
| code-quality/deterministic/useless-with-lock | Useless with-lock pattern | Lock created in `with` is never shared -- provides no synchronization. Code does not do what developer intended. |
| code-quality/deterministic/stop-iteration-in-generator | StopIteration raised in generator | RuntimeError in Python 3.7+ due to PEP 479 -- actual runtime bug |
| code-quality/deterministic/return-type-inconsistent-with-hint | Return type inconsistent with type hint | Type mismatch -- actual bug at runtime if callers rely on type |
| code-quality/deterministic/assignment-inconsistent-with-hint | Assignment inconsistent with type hint | Type mismatch -- actual bug |
| code-quality/deterministic/invalid-escape-sequence | Invalid escape sequence | Backslash that is not a valid escape -- produces wrong string content. Bug. |
| code-quality/deterministic/react-hook-setter-in-body | React hook setter in body | Calling setState in component body causes infinite render loop. This is a bug, not quality. |
| code-quality/deterministic/misleading-same-line-conditional | Misleading same-line conditional | Hides bugs where code appears to be in a block but is not |
| code-quality/deterministic/non-unique-enum-values | Non-unique enum values | Duplicate enum values -- may cause unexpected behavior at runtime |
| code-quality/deterministic/lambda-async-handler | Async Lambda handler | Lambda runtime does not support async handlers -- runtime failure. Bug. |
| code-quality/deterministic/django-receiver-decorator-order | Django @receiver not outermost | Signal handler silently fails. Bug. |
| code-quality/deterministic/and-or-ternary | and/or used as ternary | `x and y or z` fails when y is falsy -- actual bug |
| code-quality/deterministic/eq-without-hash | \_\_eq\_\_ without \_\_hash\_\_ | Instances cannot be used in sets/dicts -- TypeError at runtime |
| code-quality/deterministic/comparison-of-constant | Comparison of constants | Expression result is always the same -- dead code / likely bug |
| code-quality/deterministic/contradictory-boolean-expression | Contradictory boolean expression | Always True or always False -- logic bug |
| code-quality/deterministic/if-with-same-arms | if/else with identical bodies | Condition has no effect -- logic bug |
| code-quality/deterministic/test-not-discoverable | Test method not discoverable | Test never runs -- silent failure to test. Bug. |

---

## 3. bugs -> reliability

Rules in bugs that are really about error handling, async patterns, or resource management, fitting better under reliability.

| Rule | Name | Why it should move |
|------|------|--------------------|
| bugs/deterministic/bare-except | Bare except clause | Catching all exceptions including SystemExit -- error handling pattern, not a crash bug |
| bugs/deterministic/raise-without-from-in-except | Raise without \_\_cause\_\_ in except | Losing original traceback context -- error handling quality |
| bugs/deterministic/cancellation-exception-not-reraised | Cancellation exception swallowed | Catching CancelledError without re-raising -- prevents task cancellation. Resilience issue. |
| bugs/deterministic/error-swallowed-in-callback | Error parameter ignored in callback | Error handling pattern -- callback ignores error |
| bugs/deterministic/nested-try-catch | Deeply nested try-catch blocks | Error handling complexity -- reliability concern |
| bugs/deterministic/generic-error-message | Generic error message | "Something went wrong" without detail -- error handling quality |
| bugs/deterministic/error-type-any | Error caught as any/unknown without narrowing | Error handling pattern |
| bugs/deterministic/missing-error-boundary | React component tree without error boundary | Error handling/resilience for React -- white screen on error |
| bugs/deterministic/lost-error-context | Lost error context | Reassigning caught error -- error handling quality |
| bugs/deterministic/async-void-function | Async function returning void | Fire-and-forget loses errors -- error handling concern |
| bugs/llm/missing-error-recovery | Missing error recovery strategy | Resilience pattern, not a bug per se |
| bugs/llm/misleading-error-message | Error message does not match actual error | Error handling quality |
| bugs/llm/error-lost-in-transformation | Error information lost during transformation | Error handling pattern |

---

## 4. bugs -> security

Rules in bugs that have security implications and belong in security domain.

| Rule | Name | Why it should move |
|------|------|--------------------|
| bugs/deterministic/redos-vulnerable-regex | ReDoS vulnerable regex | Regex DoS is a security vulnerability (denial of service), not just a bug |
| bugs/deterministic/bidirectional-unicode | Bidirectional unicode control character | Trojan source attack -- can alter execution flow appearance. This is a known security vulnerability (CVE-2021-42574). |

---

## 5. architecture -> security

Rules in architecture that are really security concerns.

| Rule | Name | Why it should move |
|------|------|--------------------|
| architecture/deterministic/route-without-auth-middleware | Route without authentication middleware | Missing auth is a security vulnerability, not an architecture issue |
| architecture/deterministic/missing-rate-limiting | No rate limiting middleware | Rate limiting prevents DoS/brute force -- security concern |
| architecture/deterministic/missing-request-body-size-limit | No request body size limit | DoS prevention -- security concern |
| architecture/deterministic/raw-error-in-response | Raw error object in API response | Leaking implementation details is an information disclosure security issue |
| architecture/deterministic/missing-input-validation | Missing input validation on API endpoint | Input validation is a security concern (injection prevention) |

**Note:** These rules sit at the intersection of architecture and security. Missing auth middleware is both an architectural oversight and a security vulnerability. The question is: would a user looking for security issues find them? If the primary concern is "this is exploitable," they belong in security. If the primary concern is "this API is not properly structured," they belong in architecture. I recommend moving them to security because that is where users will look for them, and they represent actual exploitable vulnerabilities.

---

## 6. architecture -> code-quality

Rules in architecture that are really code-quality/maintainability concerns.

| Rule | Name | Why it should move |
|------|------|--------------------|
| architecture/deterministic/type-assertion-overuse | Excessive type assertions | Heavy use of `as Type` or `!` is a code quality concern, not architecture |
| architecture/deterministic/barrel-file-re-export-all | Barrel file re-exporting everything | Bundle size and IDE speed are performance/code-quality, not service boundaries or module structure |
| architecture/deterministic/declarations-in-global-scope | Declarations in global scope | Code quality/scoping issue, not service/module architecture |

---

## 7. code-quality -> reliability

Rules in code-quality that are really about error handling and resource management.

| Rule | Name | Why it should move |
|------|------|--------------------|
| code-quality/deterministic/try-except-pass | Silent exception with pass | Silently swallowing all errors is a reliability concern |
| code-quality/deterministic/try-except-continue | Silent exception with continue | Silently ignoring errors in loops -- reliability |
| code-quality/deterministic/open-file-without-context-manager | File opened without context manager | Resource leak if exception occurs -- reliability/resource cleanup |
| code-quality/deterministic/subprocess-run-without-check | subprocess.run without check | Silently ignoring non-zero exit codes -- reliability |
| code-quality/deterministic/error-instead-of-exception | logging.error instead of logging.exception | Losing traceback in error handling -- reliability |

---

## 8. code-quality -> performance

Rules in code-quality that are really performance concerns.

| Rule | Name | Why it should move |
|------|------|--------------------|
| code-quality/deterministic/readlines-in-for | readlines() in for loop | Loads all lines into memory unnecessarily -- performance |
| code-quality/deterministic/literal-membership-test | Membership test on literal list | O(n) lookup vs O(1) with set -- performance |
| code-quality/deterministic/typing-only-import | Runtime import used only for type checking | Reduces runtime overhead -- performance concern |

---

## 9. code-quality -> architecture

Rules in code-quality that are really about module structure/dependencies.

| Rule | Name | Why it should move |
|------|------|--------------------|
| code-quality/deterministic/env-in-library-code | process.env access in library/domain code | Dependency injection concern -- architecture |
| code-quality/deterministic/import-private-name | Import of private name | Violating module boundaries -- architecture |
| code-quality/deterministic/private-member-access | External access to private member | Violating encapsulation boundaries -- architecture |
| code-quality/deterministic/internal-api-usage | Internal API usage | Using internal/private APIs -- architecture/coupling |

---

## 10. bugs -> performance

Rules in bugs that are really performance issues, not crashes or incorrect results.

| Rule | Name | Why it should move |
|------|------|--------------------|
| bugs/deterministic/await-in-loop | Sequential await in loop | Causes sequential execution instead of parallel -- performance issue, not a bug (code still produces correct results) |
| bugs/deterministic/blocking-call-in-async | Blocking call in async function | Blocks event loop -- this is a performance/reliability issue. The code produces correct results but is slow. |
| bugs/deterministic/async-busy-wait | Async busy wait loop | Using sleep loop instead of events -- performance/reliability pattern |

**Note:** `blocking-call-in-async` is borderline. It blocks the event loop which can cause timeouts and stalled requests, so it could also be reliability. But the core issue is performance degradation.

---

## 11. database -> reliability

Rules in database that overlap significantly with reliability.

| Rule | Name | Why it should move |
|------|------|--------------------|
| database/deterministic/connection-not-released | Database connection not released | Resource cleanup / connection pool exhaustion -- reliability pattern |

---

## 12. database -> security

Rules in database that have security implications.

| Rule | Name | Why it should move |
|------|------|--------------------|
| database/llm/sensitive-data-unencrypted | Sensitive data stored unencrypted | PII/secrets stored as plain text -- this is a security vulnerability |
| database/deterministic/unvalidated-external-data | External data used without validation | Input validation -- security concern (injection, corruption) |

---

## 13. architecture -> reliability

| Rule | Name | Why it should move |
|------|------|--------------------|
| architecture/deterministic/missing-error-status-code | Catch block sending 200 on error | Error handling returning wrong status -- reliability issue, not architecture |
| architecture/llm/middleware-order-incorrect | Incorrect Express middleware ordering | Auth/body parser after routes -- could also be security; at minimum it is a reliability concern |

---

## 14. security -> reliability

| Rule | Name | Why it should move |
|------|------|--------------------|
| security/deterministic/non-octal-file-permissions | File permissions not in octal format | Using decimal vs octal for permissions is a code clarity/bug-risk issue, not a security vulnerability. The permissions themselves may be fine. Could be code-quality or bugs. |

---

## 15. code-quality -> bugs (Python-specific)

Additional Python rules in code-quality that detect actual runtime bugs.

| Rule | Name | Why it should move |
|------|------|--------------------|
| code-quality/deterministic/bare-raise-outside-except | Bare raise outside except block | RuntimeError at runtime -- bug |
| code-quality/deterministic/property-with-parameters | Property with parameters | Properties should not take args -- TypeError if called with args |
| code-quality/deterministic/duplicate-class-field | Duplicate class field definition | Last definition wins, earlier ones are dead code -- likely bug |
| code-quality/deterministic/iteration-over-set | Iteration over set | Non-deterministic order -- can cause intermittent bugs |

---

## Summary of Recommended Moves

| Move | Count | Confidence |
|------|-------|------------|
| code-quality -> style | ~35 strong + ~10 borderline | High for strong candidates |
| code-quality -> bugs | ~25 | High |
| bugs -> reliability | ~13 | High |
| bugs -> security | 2 | High |
| architecture -> security | 5 | High |
| architecture -> code-quality | 3 | Medium |
| code-quality -> reliability | 5 | High |
| code-quality -> performance | 3 | Medium |
| code-quality -> architecture | 4 | Medium |
| bugs -> performance | 3 | Medium |
| database -> security | 2 | High |
| database -> reliability | 1 | Medium |
| architecture -> reliability | 2 | Medium |
| security -> code-quality/bugs | 1 | Low |
| **Total** | **~104** | |

---

## Recommendations

1. **Highest priority moves:** architecture -> security (5 rules). These are real security vulnerabilities hiding in the architecture domain. Users scanning for security issues will miss them.

2. **Second priority:** code-quality -> bugs (~25 rules). Rules like `missing-env-validation`, `implicit-string-concatenation`, `cached-instance-method`, `lambda-async-handler`, and `react-hook-setter-in-body` detect actual runtime failures, not just code smells.

3. **Third priority:** bugs -> reliability (~13 rules). Error handling patterns like `bare-except`, `error-swallowed-in-callback`, `generic-error-message` are about how the system handles failures, not about producing wrong results.

4. **Fourth priority:** code-quality -> style (~35 rules). The code-quality domain is bloated with syntax preferences. Moving pure "prefer X over Y" rules to style would make both domains more focused.

5. **Keep the borderline cases in code-quality** unless you want to be aggressive about domain purity. Rules like `strict-equality`, `prefer-const`, and `prefer-nullish-coalescing` have legitimate arguments for being quality issues (they prevent subtle bugs).

6. **database -> security for sensitive-data-unencrypted** is important -- storing PII in plaintext is a security finding, not a schema design issue.
