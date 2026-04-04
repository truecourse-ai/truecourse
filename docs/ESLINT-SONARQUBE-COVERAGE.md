# ESLint & SonarQube Rule Coverage Plan

Goal: Build all valuable ESLint and SonarQube rules into TrueCourse's tree-sitter analysis engine, eliminating the need for either tool.

## Existing Rules (10 code rules + 3 deterministic)

- `code/empty-catch` — Empty error handlers
- `code/console-log` — Debug logging in production
- `code/no-explicit-any` — Untyped escape hatch
- `code/sql-injection` — String interpolation in DB queries
- `code/hardcoded-secret` — API keys/tokens/passwords in strings
- `code/todo-fixme` — TODO/FIXME comments
- `code/star-import` — Wildcard imports
- `code/bare-except` — Python bare except
- `code/mutable-default-arg` — Python mutable defaults
- `code/global-statement` — Global state mutation
- God module detection (>15 methods)
- Unused exports
- Circular dependencies

---

## Priority 1: AST Pattern Matching (Easy)

Pure tree-sitter node matching — same approach as existing rules.

### Bugs

| Rule | What It Catches | Source | Severity | JS/TS | Python |
|---|---|---|---|---|---|
| `no-self-compare` | `x === x` — always a copy-paste bug | ESLint | medium | yes | yes |
| `no-cond-assign` | `if (x = 5)` instead of `===` | ESLint | high | yes | no |
| `use-isnan` | `x === NaN` — always false | ESLint | high | yes | no |
| `no-unreachable` | Code after return/throw/break | ESLint | medium | yes | yes |
| `no-async-promise-executor` | `new Promise(async () => {})` — errors are lost | ESLint | high | yes | no |
| `no-template-curly-in-string` | `"${name}"` in regular string instead of backticks | ESLint | medium | yes | no |
| `no-identical-conditions` | Same condition in if/else-if chain — dead branch | SonarJS | high | yes | yes |
| `no-identical-expressions` | `a - a`, `x && x` — copy-paste bug | SonarJS | medium | yes | yes |
| `no-one-iteration-loop` | Loop that always breaks on first iteration | SonarJS | medium | yes | yes |
| `no-constructor-return` | Returning value from constructor | ESLint | medium | yes | no |
| `no-setter-return` | Returning value from setter | ESLint | medium | yes | no |
| `no-promise-executor-return` | Returning value from Promise executor | ESLint | medium | yes | no |
| `no-fallthrough` | Switch case without break/return | ESLint | medium | yes | no |

### Security

| Rule | What It Catches | Source | Severity | JS/TS | Python |
|---|---|---|---|---|---|
| `eval-with-expression` | `eval(variable)` — arbitrary code execution | eslint-plugin-security | critical | yes | yes |
| `command-injection` | `exec(variable)` / `os.system(var)` — shell injection | eslint-plugin-security | critical | yes | yes |
| `non-literal-regexp` | `new RegExp(variable)` — ReDoS risk | eslint-plugin-security | high | yes | yes |
| `no-prototype-builtins` | `obj.hasOwnProperty()` on untrusted objects | ESLint | medium | yes | no |
| `object-injection` | `obj[userInput]` — proto pollution | eslint-plugin-security | medium | yes | no |

### Complexity

| Rule | What It Catches | Source | Severity | JS/TS | Python |
|---|---|---|---|---|---|
| `cognitive-complexity` | SonarQube's flagship metric (threshold 15) | SonarJS S3776 | medium | yes | yes |
| `max-nesting-depth` | >4 levels of nesting | ESLint | medium | yes | yes |
| `max-params` | Functions with >4 parameters | ESLint | low | yes | yes |
| `max-function-lines` | Functions >60 lines | ESLint | low | yes | yes |

**Total: 22 rules**

---

## Priority 2: Local Data-Flow Tracking (Medium)

Requires tracking variable assignments, return values, or control flow within a single function. Still single-file, tree-sitter based.

### Bugs

| Rule | What It Catches | Source | Severity | JS/TS | Python |
|---|---|---|---|---|---|
| `no-unsafe-optional-chaining` | `(obj?.foo) + 1` — TypeError | ESLint | high | yes | no |
| `array-callback-return` | `.map()` callback missing return | ESLint | high | yes | no |
| `no-floating-promises` | Unhandled promise (no await/catch) | @typescript-eslint | high | yes | no |
| `no-all-duplicated-branches` | All if/else branches identical — useless condition | SonarJS | medium | yes | yes |
| `no-use-of-empty-return-value` | Using return of void function | SonarJS | high | yes | yes |
| `no-unmodified-loop-condition` | Loop variable never modified — infinite loop | ESLint | high | yes | yes |
| `loop-closure-capture` | Closure in loop captures mutable variable | SonarJS / flake8-B023 | high | yes | yes |
| `detect-unsafe-regex` | Regex with exponential backtracking | eslint-plugin-security | high | yes | yes |
| `detect-timing-attacks` | Non-constant-time secret comparison | eslint-plugin-security | medium | yes | yes |

### Code Smells

| Rule | What It Catches | Source | Severity | JS/TS | Python |
|---|---|---|---|---|---|
| `no-collapsible-if` | Nested ifs that should be merged | SonarJS | info | yes | yes |
| `no-redundant-jump` | Useless return/continue/break at end of block | SonarJS | info | yes | yes |
| `no-redundant-boolean` | `x ? true : false`, `if (x === true)` | SonarJS | info | yes | yes |
| `no-duplicated-branches` | Two branches with identical code | SonarJS | low | yes | yes |
| `no-identical-functions` | Duplicate function bodies (3+ lines) | SonarJS S4144 | low | yes | yes |
| `no-unused-collection` | Array/map/set populated but never read | SonarJS | medium | yes | yes |
| `no-extra-arguments` | More arguments than parameters | SonarJS | medium | yes | yes |
| `no-duplicate-string` | Same string literal 3+ times | SonarJS | low | yes | yes |
| `require-await` | `async` function with no `await` | @typescript-eslint | low | yes | yes |
| `no-loss-of-precision` | Number literals beyond IEEE 754 precision | ESLint | medium | yes | no |
| `no-nested-switch` | Switch inside switch | SonarJS | low | yes | no |
| `no-nested-template-literals` | Template literal inside template literal | SonarJS | low | yes | no |
| `no-constant-binary-expression` | Comparisons whose result is always the same | ESLint | high | yes | no |

**Total: 22 rules**

---

## Priority 3: Type-Aware Rules (Medium)

Requires TypeScript type information. Uses our existing `ts-compiler.ts` with `ts.Program` and type checker.

| Rule | What It Catches | Source | Severity |
|---|---|---|---|
| `no-misused-promises` | Promise used as boolean condition (`if (asyncFn())`) | @typescript-eslint | high |
| `no-for-in-array` | `for...in` on arrays (iterates string indices) | @typescript-eslint | medium |
| `no-unsafe-assignment` | Assigning `any` typed value to a typed variable | @typescript-eslint | medium |
| `no-unsafe-return` | Returning `any` typed value from a typed function | @typescript-eslint | medium |
| `no-unsafe-call` | Calling an `any` typed value as a function | @typescript-eslint | medium |
| `no-unsafe-member-access` | Accessing a member on an `any` typed value | @typescript-eslint | medium |
| `no-unsafe-argument` | Passing `any` typed value to a typed parameter | @typescript-eslint | medium |
| `strict-boolean-expressions` | Non-boolean values in boolean contexts | @typescript-eslint | medium |
| `no-unnecessary-type-assertion` | Type assertions that don't change the type | @typescript-eslint | low |
| `no-unnecessary-condition` | Conditions that are always true or always false based on types | @typescript-eslint | medium |
| `no-redundant-type-constituents` | Union/intersection types with redundant members | @typescript-eslint | low |
| `no-confusing-void-expression` | Returning void expressions where a value is expected | @typescript-eslint | medium |
| `await-thenable` | Awaiting a non-thenable value | @typescript-eslint | medium |
| `no-base-to-string` | Calling `.toString()` on objects that don't meaningfully implement it | @typescript-eslint | medium |
| `restrict-plus-operands` | Using `+` with mixed types (string + number) | @typescript-eslint | medium |
| `restrict-template-expressions` | Non-string values in template literal expressions | @typescript-eslint | medium |
| `unbound-method` | Passing class methods without binding (loses `this` context) | @typescript-eslint | high |
| `no-meaningless-void-operator` | `void` operator on expressions already typed as void | @typescript-eslint | low |
| `dead-store` | Variable assigned but never read before overwrite or scope exit | SonarQube S1854 | medium |
| `prefer-return-this-type` | Methods returning `this` should use polymorphic `this` type | @typescript-eslint | low |

**Total: ~20 rules (TypeScript only)**

---

## Priority 4: Cross-File Taint Analysis Engine (High Effort)

Build a taint tracking engine on top of our existing dependency graph and method-level call tracking. This is what makes SonarQube's security analysis genuinely valuable — tracking data from sources to sinks across files and function calls.

### Architecture

```
Taint Engine
├── Source definitions (where tainted data enters)
│   ├── req.body, req.query, req.params, req.headers
│   ├── process.env (configurable)
│   ├── window.location, document.cookie
│   ├── user input (readline, prompt)
│   └── database query results (configurable)
├── Sink definitions (where tainted data is dangerous)
│   ├── eval(), Function(), child_process.exec()
│   ├── SQL query strings, ORM raw queries
│   ├── innerHTML, document.write()
│   ├── res.redirect(), window.location.href
│   ├── fs.readFile(), fs.writeFile() (path traversal)
│   ├── crypto with weak algorithms
│   └── HTTP response headers (header injection)
├── Sanitizer definitions (transforms that make data safe)
│   ├── Input validation (Zod, Joi, validator.js)
│   ├── Parameterized queries (prepared statements)
│   ├── DOMPurify, escape functions
│   ├── parseInt(), Number() (for numeric contexts)
│   └── URL validation libraries
└── Propagation rules
    ├── Assignments: taint propagates through variable assignment
    ├── Function calls: taint propagates through arguments → return values
    ├── String operations: concatenation, template literals propagate taint
    ├── Object spread/destructuring: taint propagates to properties
    └── Cross-file: follow import/export + dependency graph
```

### Security Rules Enabled by Taint Analysis

| Rule | What It Catches | SonarQube ID | Severity |
|---|---|---|---|
| `cross-file-sql-injection` | User input reaching SQL query across files | S2077 | critical |
| `cross-file-xss` | User input reaching DOM manipulation across files | S5131 | critical |
| `cross-file-command-injection` | User input reaching shell exec across files | S2076 | critical |
| `open-redirect` | User input reaching redirect URL | S5146 | high |
| `ssrf` | User input reaching HTTP request URL | S5144 | high |
| `path-traversal` | User input reaching file system paths | S2083 | high |
| `ldap-injection` | User input reaching LDAP queries | S2078 | high |
| `regex-injection` | User input reaching RegExp constructor | S2631 | high |
| `header-injection` | User input reaching HTTP response headers | S5167 | high |
| `jwt-no-verify` | JWT tokens accepted without signature verification | S5659 | critical |
| `weak-crypto` | Using MD5/SHA-1 for security purposes | S5547 | high |
| `crypto-no-salt` | Hashing passwords without salt | S4790 | high |
| `insecure-cookie` | Cookies without secure/httpOnly/sameSite flags | S2092 | medium |
| `cors-permissive` | Overly permissive CORS configuration (`*`) | S5122 | medium |
| `hardcoded-credentials` | Database connection strings with inline passwords | S2068 | critical |
| `weak-tls` | Allowing TLS 1.0/1.1 | S4423 | high |
| `math-random-security` | Using Math.random() for security-sensitive purposes | S2245 | high |
| `no-cleartext-protocols` | Using HTTP/FTP/Telnet instead of HTTPS/SFTP/SSH | S5332 | medium |
| `deserialization` | Deserializing untrusted data (JSON.parse of user input into eval-like context) | S5135 | high |
| `log-injection` | User input reaching log statements without sanitization | S5145 | medium |

**Total: ~20 rules (requires taint engine)**

Additional ~10 rules for Python-specific sinks (pickle.loads, yaml.load, subprocess, etc.)

---

## Priority 5: Duplicate Code Detection (Medium Effort)

Token-based comparison algorithm to detect copy-pasted code blocks across the codebase.

### Approach
1. Tokenize each file (strip whitespace, normalize identifiers)
2. Build token sequences using a sliding window (e.g., 50 tokens)
3. Hash each window, compare across files
4. Merge overlapping matches into contiguous duplicate blocks
5. Report duplicate blocks with file locations and percentage

### Rule

| Rule | What It Catches | Source | Severity |
|---|---|---|---|
| `duplicate-code` | Copy-pasted code blocks (configurable threshold, e.g., 10+ lines) | SonarQube CPD | low |

---

## Intentionally Skipped: Stylistic/Formatting Rules (~80 ESLint rules)

ESLint itself deprecated these rules and moved them to `@stylistic/eslint-plugin`. Formatting is handled by Prettier/formatters, not static analyzers. These include:

- Indentation, spacing, semicolons, brace style
- Comma dangle, quotes, trailing commas
- Line length, padding, blank lines

**These are not part of our scope.**

---

## Summary

| Category | Rule Count | Effort | Approach |
|---|---|---|---|
| Priority 1: AST patterns | 22 | Low | Tree-sitter node matching |
| Priority 2: Local data-flow | 22 | Medium | Tree-sitter + variable tracking |
| Priority 3: Type-aware | ~20 | Medium | ts-compiler.ts type checker |
| Priority 4: Taint analysis | ~30 | High | Build taint engine on dependency graph |
| Priority 5: Duplicate detection | 1 | Medium | Token-based comparison |
| Skipped: Stylistic | ~80 | — | Prettier's job |
| **Total new rules** | **~95 + taint engine + duplicate detection** | | |
| Existing rules | 13 | | |
| **Grand total** | **~108 rules** | | |

This covers everything meaningful from ESLint core, @typescript-eslint, eslint-plugin-security, eslint-plugin-sonarjs, and SonarQube's full JS/TS analyzer — minus formatting rules that belong to Prettier.
