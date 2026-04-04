# TrueCourse Engineering Rules — Beyond Linters

> Rules that go beyond what ESLint, SonarQube, madge, and gitleaks cover.
> These are the rules a senior architect would flag during code review or architecture review.
> Generated: 2026-04-02
>
> **Rule key format:** `{domain}/{detection}/{name}`
> **Domains:** architecture, security, bugs, code-quality, database, performance, reliability
> **Detection:** deterministic (tree-sitter + dependency graph), llm (requires LLM judgment)
>
> **Detection notes:**
> - "deterministic" means detectable via tree-sitter AST patterns, dependency graph analysis, or regex on parsed code
> - "llm" means requires semantic understanding, context about intent, or cross-file reasoning that AST alone cannot provide

---

## Performance

Rules about runtime efficiency, memory usage, rendering, caching, and data access patterns.

### Performance / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| performance/deterministic/missing-key-prop | Missing or index-based key in list render | React list render using array index as key or missing key prop, causing unnecessary re-renders and broken state | medium | truecourse-new | perf/missing-key-prop | new | js/ts |
| performance/deterministic/inline-function-in-jsx-prop | Inline function in JSX prop | Arrow function or .bind() in JSX props causes new reference every render, defeating React.memo and PureComponent | low | truecourse-new | perf/inline-function-jsx | new | js/ts |
| performance/deterministic/inline-object-in-jsx-prop | Inline object literal in JSX prop | Object literal `style={{...}}` or `options={{...}}` in JSX creates new reference every render | low | truecourse-new | perf/inline-object-jsx | new | js/ts |
| performance/deterministic/missing-cleanup-useeffect | useEffect without cleanup for subscriptions | useEffect that adds event listeners, timers, or subscriptions but returns no cleanup function | high | truecourse-new | perf/missing-cleanup-useeffect | new | js/ts |
| performance/deterministic/settimeout-setinterval-no-clear | Timer created without corresponding clear | setInterval/setTimeout assigned but never cleared — memory leak in long-running processes | medium | truecourse-new | perf/timer-no-clear | new | js/ts |
| performance/deterministic/event-listener-no-remove | Event listener added without removal | addEventListener without corresponding removeEventListener in cleanup or destroy path | medium | truecourse-new | perf/event-listener-no-remove | new | all |
| performance/deterministic/sync-fs-in-request-handler | Synchronous filesystem operation in request path | fs.readFileSync, fs.writeFileSync etc. used inside Express/Fastify/Koa route handler — blocks event loop | high | truecourse-new | perf/sync-fs-request | new | js/ts |
| performance/deterministic/json-parse-in-loop | JSON.parse or JSON.stringify inside hot loop | Serialization/deserialization inside a loop body — expensive and often avoidable | medium | truecourse-new | perf/json-in-loop | new | js/ts |
| performance/deterministic/regex-in-loop | Regex compilation inside loop | `new RegExp()` inside loop body — regex should be compiled once outside the loop | low | truecourse-new | perf/regex-in-loop | new | all |
| performance/deterministic/unbounded-array-growth | Array pushed to without bounds check | Array.push in loop or recurring callback without size limit — potential unbounded memory growth | medium | truecourse-new | perf/unbounded-array | new | js/ts |
| performance/deterministic/large-bundle-import | Full library import when partial available | Importing entire library (lodash, moment, date-fns) instead of specific function paths | medium | truecourse-new | perf/large-bundle-import | new | js/ts |
| performance/deterministic/await-in-loop | Sequential await in loop | `await` inside for/while loop when iterations are independent — should use Promise.all | medium | truecourse-new | perf/await-in-loop | new | js/ts |
| performance/deterministic/missing-usememo-expensive | Expensive computation without memoization | Array.filter/map/sort/reduce on large datasets in render body without useMemo | low | truecourse-new | perf/missing-usememo | new | js/ts |
| performance/deterministic/state-update-in-loop | Multiple setState calls in loop | Calling setState inside a loop instead of batching — causes multiple re-renders | medium | truecourse-new | perf/state-update-loop | new | js/ts |
| performance/deterministic/synchronous-crypto | Synchronous crypto operations | Using crypto.pbkdf2Sync, crypto.scryptSync etc. — blocks event loop on CPU-intensive work | medium | truecourse-new | perf/sync-crypto | new | js/ts |
| performance/deterministic/console-log-in-production | Console.log statements in production code | console.log/debug/info left in non-test source files — performance cost and information leak | low | truecourse-new | perf/console-in-prod | new | js/ts |
| performance/deterministic/spread-in-reduce | Spread operator in reduce accumulator | `{...acc, [key]: value}` in reduce creates new object each iteration — O(n^2) behavior | medium | truecourse-new | perf/spread-in-reduce | new | js/ts |

### Performance / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| performance/llm/n-plus-one-query | N+1 query pattern | Loop fetching related data one record at a time instead of batching or joining — requires understanding data access pattern | high | truecourse-new | perf/n-plus-one | new | all |
| performance/llm/missing-database-index | Missing database index for frequent query | Query filters on columns without indexes — detectable by analyzing query patterns vs schema | medium | truecourse-new | perf/missing-index | new | all |
| performance/llm/missing-caching-opportunity | Cacheable data fetched repeatedly | Expensive or slow data fetched on every request when it changes infrequently | medium | truecourse-new | perf/missing-cache | new | all |
| performance/llm/overfetching-data | Fetching more data than needed | Query selects all columns or all records when only a subset is used — requires understanding usage context | medium | truecourse-new | perf/overfetch | new | all |
| performance/llm/unnecessary-rerender-prop-drilling | Unnecessary re-renders from prop drilling | State passed through many component layers causing subtree re-renders when only leaf needs the data | medium | truecourse-new | perf/prop-drill-rerender | new | js/ts |
| performance/llm/blocking-main-thread | CPU-intensive work on main thread | Complex computation, large data processing, or image manipulation without Web Worker or worker thread | medium | truecourse-new | perf/blocking-main-thread | new | js/ts |
| performance/llm/redundant-api-calls | Redundant API calls | Same API endpoint called multiple times in quick succession when result could be shared | medium | truecourse-new | perf/redundant-api-calls | new | all |
| performance/llm/inefficient-data-structure | Inefficient data structure choice | Using array for frequent lookups (O(n)) when Map/Set would be O(1), or vice versa | medium | truecourse-new | perf/inefficient-data-structure | new | all |
| performance/llm/unoptimized-database-query | Unoptimized database query | Query using patterns known to prevent index usage (e.g., function on indexed column, OR conditions, leading wildcards) | medium | truecourse-new | perf/unoptimized-query | new | all |
| performance/llm/missing-pagination | Missing pagination on large dataset query | Database query without LIMIT/OFFSET on potentially large table — unbounded result set | high | truecourse-new | perf/missing-pagination-query | new | all |

---

## Reliability

Rules about error handling, resilience, fault tolerance, and system stability.

### Reliability / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| reliability/deterministic/unhandled-promise-rejection | Unhandled promise rejection | Async function called without .catch() or try/catch and not awaited — unhandled rejection crashes Node.js | high | truecourse-new | rel/unhandled-promise | new | js/ts |
| reliability/deterministic/floating-promise | Floating promise (not awaited or returned) | Promise-returning function called without await, return, or .then() — result silently discarded | high | truecourse-new | rel/floating-promise | new | js/ts |
| reliability/deterministic/empty-catch-block | Empty catch block | catch block with no logging, rethrowing, or error handling — error silently swallowed | high | truecourse-new | rel/empty-catch | new | all |
| reliability/deterministic/catch-without-error-type | Catch-all exception handler | Catching generic Error/Exception without filtering by type — may hide unrelated bugs | medium | truecourse-new | rel/catch-all | new | all |
| reliability/deterministic/promise-all-no-error-handling | Promise.all without individual error handling | Promise.all fails fast on first rejection — use Promise.allSettled or add per-promise catch if partial success is acceptable | medium | truecourse-new | rel/promise-all-failfast | new | js/ts |
| reliability/deterministic/missing-finally-cleanup | Missing finally block for resource cleanup | Resource acquisition (file handle, connection, lock) without finally block or using pattern to ensure release | medium | truecourse-new | rel/missing-finally | new | all |
| reliability/deterministic/throw-string-literal | Throwing string instead of Error object | `throw "error"` or `throw 'message'` instead of `throw new Error()` — loses stack trace | medium | truecourse-new | rel/throw-string | new | js/ts |
| reliability/deterministic/unchecked-optional-chain-depth | Deep optional chaining without fallback | `a?.b?.c?.d?.e` chains suggest unstable data shape — likely missing validation at boundary | low | truecourse-new | rel/deep-optional-chain | new | js/ts |
| reliability/deterministic/missing-default-in-switch | Switch without default case | Switch statement missing default case — unhandled enum values silently fall through | medium | truecourse-new | rel/missing-switch-default | new | all |
| reliability/deterministic/unsafe-json-parse | JSON.parse without try-catch | JSON.parse on external/user input without try-catch — throws on malformed JSON | high | truecourse-new | rel/unsafe-json-parse | new | js/ts |
| reliability/deterministic/http-call-no-timeout | HTTP/fetch call without timeout | External HTTP request (fetch, axios, got) without timeout configuration — can hang indefinitely | high | truecourse-new | rel/http-no-timeout | new | all |
| reliability/deterministic/missing-error-event-handler | Missing error event handler | EventEmitter, stream, or WebSocket created without 'error' event listener — unhandled errors crash process | high | truecourse-new | rel/missing-error-handler | new | js/ts |
| reliability/deterministic/process-exit-in-library | process.exit in library code | process.exit() called in library/module code instead of throwing — prevents graceful cleanup by caller | high | truecourse-new | rel/process-exit-library | new | js/ts |
| reliability/deterministic/unchecked-array-access | Unchecked array index access | Accessing array by index without bounds check — returns undefined, may cause downstream errors | low | truecourse-new | rel/unchecked-array-access | new | js/ts |
| reliability/deterministic/missing-null-check-after-find | Missing null check after .find() | Array.find() result used directly without null/undefined check — find can return undefined | medium | truecourse-new | rel/missing-find-null-check | new | js/ts |

### Reliability / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| reliability/llm/missing-retry-logic | Missing retry logic on network calls | External API/service call without retry mechanism — transient failures cause permanent failure | medium | truecourse-new | rel/missing-retry | new | all |
| reliability/llm/missing-circuit-breaker | Missing circuit breaker on external dependency | Repeated calls to failing external service without circuit breaker — cascading failure risk | medium | truecourse-new | rel/missing-circuit-breaker | new | all |
| reliability/llm/race-condition-shared-state | Race condition on shared mutable state | Multiple async operations reading/writing same state without synchronization | high | truecourse-new | rel/race-condition | new | all |
| reliability/llm/missing-graceful-shutdown | Missing graceful shutdown handler | Server does not handle SIGTERM/SIGINT for clean connection drain and resource cleanup | medium | truecourse-new | rel/missing-graceful-shutdown | new | js/ts |
| reliability/llm/unbounded-queue | Unbounded queue or buffer | Queue/buffer that grows without backpressure — memory exhaustion under load | high | truecourse-new | rel/unbounded-queue | new | all |
| reliability/llm/missing-idempotency | Non-idempotent mutation endpoint | POST/PUT endpoint that creates side effects without idempotency key — unsafe to retry | medium | truecourse-new | rel/missing-idempotency | new | all |
| reliability/llm/missing-dead-letter-handling | Missing dead letter handling | Message queue consumer without dead letter queue — poison messages block processing forever | medium | truecourse-new | rel/missing-dlq | new | all |
| reliability/llm/partial-failure-not-handled | Partial failure in batch operation | Batch operation that fails entirely if one item fails — should handle partial success | medium | truecourse-new | rel/partial-failure | new | all |
| reliability/llm/missing-health-check | Missing health check endpoint | Service without /health or /ready endpoint — orchestrator cannot determine service health | medium | truecourse-new | rel/missing-health-check | new | all |
| reliability/llm/stale-cache-no-invalidation | Cache without invalidation strategy | Data cached without TTL, versioning, or invalidation — serves stale data indefinitely | medium | truecourse-new | rel/stale-cache | new | all |

---

## API Design

Rules about REST/GraphQL API consistency, contracts, and best practices.

### API Design / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| architecture/deterministic/missing-input-validation | Missing input validation on API endpoint | Route handler accesses req.body/req.params/req.query without validation (Zod, Joi, etc.) | high | truecourse-new | api/missing-validation | new | js/ts |
| architecture/deterministic/missing-pagination-endpoint | List endpoint without pagination | GET endpoint returning array without limit/offset/cursor parameters — unbounded response | high | truecourse-new | api/missing-pagination | new | all |
| architecture/deterministic/missing-error-status-code | Catch block sending 200 on error | Error caught but response sent with 200 status — clients cannot distinguish success from failure | high | truecourse-new | api/error-200 | new | all |
| architecture/deterministic/route-without-auth-middleware | Route without authentication middleware | Express/Fastify route registered without auth middleware on non-public path | high | truecourse-new | api/route-no-auth | new | js/ts |
| architecture/deterministic/missing-rate-limiting | No rate limiting middleware | API application with no rate limiting middleware registered — vulnerable to abuse | medium | truecourse-new | api/no-rate-limit | new | js/ts |
| architecture/deterministic/missing-request-body-size-limit | No request body size limit | Express/body-parser configured without body size limit — denial of service via large payloads | medium | truecourse-new | api/no-body-limit | new | js/ts |
| architecture/deterministic/raw-error-in-response | Raw error object in API response | Sending error.message or error.stack directly in response — leaks implementation details | medium | truecourse-new | api/raw-error-response | new | all |

### API Design / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| architecture/llm/inconsistent-response-format | Inconsistent API response format | Endpoints return data in different shapes (some wrapped, some not, different error formats) | medium | truecourse-new | api/inconsistent-format | new | all |
| architecture/llm/breaking-api-change | Breaking API contract change | Endpoint removes or renames fields, changes types, or alters behavior without versioning | high | truecourse-new | api/breaking-change | new | all |
| architecture/llm/missing-api-versioning | Missing API versioning | Public API without version prefix (/v1/) — no path for backward-compatible evolution | medium | truecourse-new | api/no-versioning | new | all |
| architecture/llm/over-exposed-internal-model | Internal data model exposed in API | Database schema or internal object structure leaked directly in API response — coupling clients to internals | medium | truecourse-new | api/internal-model-exposed | new | all |
| architecture/llm/chatty-api | Chatty API requiring many round trips | Client needs multiple sequential API calls to accomplish single logical operation — should be combined | medium | truecourse-new | api/chatty | new | all |
| architecture/llm/wrong-http-method | Incorrect HTTP method for operation | Using GET for mutations or POST for idempotent reads — violates REST semantics | low | truecourse-new | api/wrong-method | new | all |
| architecture/llm/missing-api-error-documentation | Undocumented error responses | API endpoint can return error codes not documented or not typed — clients cannot handle them | low | truecourse-new | api/undocumented-errors | new | all |

---

## Observability

Rules about logging, monitoring, tracing, and debuggability.

### Observability / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| reliability/deterministic/catch-rethrow-no-context | Catch and rethrow without adding context | Exception caught and rethrown without wrapping or adding context — loses information about where/why it failed | medium | truecourse-new | obs/rethrow-no-context | new | all |
| reliability/deterministic/catch-and-ignore | Catch block that ignores error | Catch block that neither logs, rethrows, nor handles the error in any meaningful way | high | truecourse-new | obs/catch-ignore | new | all |
| reliability/deterministic/console-error-no-context | console.error with just error object | `console.error(err)` without contextual message — hard to trace which operation failed | low | truecourse-new | obs/error-no-context | new | js/ts |
| reliability/deterministic/logging-sensitive-data | Logging request/response body without filtering | Logging full request or response body which may contain passwords, tokens, or PII | high | truecourse-new | obs/log-sensitive | new | all |

### Observability / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| reliability/llm/missing-correlation-id | Missing request correlation/trace ID | Request handling without propagating correlation ID — cannot trace request across services | medium | truecourse-new | obs/no-correlation-id | new | all |
| reliability/llm/inconsistent-logging | Inconsistent logging patterns | Mix of console.log, custom logger, and third-party logger in same codebase — hard to configure and filter | low | truecourse-new | obs/inconsistent-logging | new | all |
| reliability/llm/missing-structured-logging | Unstructured log messages | Using string interpolation for logs instead of structured key-value logging — hard to parse and query | low | truecourse-new | obs/unstructured-logs | new | all |
| reliability/llm/missing-error-monitoring | No error monitoring integration | Application without error tracking service (Sentry, Bugsnag, etc.) — errors only visible in logs | low | truecourse-new | obs/no-error-monitoring | new | all |
| reliability/llm/silent-background-failure | Silent background job failure | Background job/cron/worker that catches errors without alerting or recording failure state | high | truecourse-new | obs/silent-bg-failure | new | all |
| reliability/llm/missing-metrics | Missing performance metrics | No instrumentation for response times, queue depths, or resource utilization — blind to degradation | low | truecourse-new | obs/no-metrics | new | all |

---

## Data Integrity

Rules about data validation, consistency, transactions, and safe data handling.

### Data Integrity / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| database/deterministic/missing-transaction | Multiple related writes without transaction | Multiple INSERT/UPDATE/DELETE calls that should be atomic but are not wrapped in a transaction | high | truecourse-new | data/missing-transaction | new | all |
| database/deterministic/raw-sql-string-concat | SQL query built with string concatenation | Building SQL with template literals or string concatenation — SQL injection risk and no parameterization | high | truecourse-new | data/sql-concat | new | all |
| database/deterministic/unvalidated-external-data | External data used without validation | Data from API response, file, or message queue used directly without schema validation | high | truecourse-new | data/unvalidated-external | new | all |
| database/deterministic/missing-unique-constraint | Duplicate prevention via application code only | Uniqueness enforced in application code but not in database schema — race conditions can create duplicates | medium | truecourse-new | data/missing-unique-constraint | new | all |
| database/deterministic/unsafe-delete-without-where | DELETE/UPDATE without WHERE clause | SQL DELETE or UPDATE statement without WHERE condition — affects all rows in table | critical | truecourse-new | data/delete-no-where | new | all |
| database/deterministic/missing-foreign-key | Related table without foreign key constraint | Tables with logical relationships (matching column names) but no foreign key — orphaned records possible | medium | truecourse-new | data/missing-fk | new | all |

### Data Integrity / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| database/llm/inconsistent-data-validation | Validation in some paths but not others | Same data type validated in one endpoint but not another — inconsistent enforcement | high | truecourse-new | data/inconsistent-validation | new | all |
| database/llm/missing-cascade-logic | Missing cascade on delete | Parent record deleted without handling child records — orphaned data or foreign key violation | medium | truecourse-new | data/missing-cascade | new | all |
| database/llm/stale-read-after-write | Read-after-write without consistency guarantee | Writing to database then immediately reading — may get stale data with replicas or eventual consistency | medium | truecourse-new | data/stale-read | new | all |
| database/llm/schema-drift-risk | Schema accessed without migration | Direct DDL statements or schema modifications outside the migration system — drift between environments | high | truecourse-new | data/schema-drift | new | all |
| database/llm/sensitive-data-unencrypted | Sensitive data stored unencrypted | PII, passwords, or secrets stored in database as plain text instead of encrypted/hashed | critical | truecourse-new | data/unencrypted-sensitive | new | all |
| database/llm/missing-soft-delete | Hard delete on auditable entity | Business entity deleted permanently when soft delete (is_deleted flag) would be required for audit trail | medium | truecourse-new | data/missing-soft-delete | new | all |

---

## Configuration

Rules about environment management, constants, and deployment safety.

### Configuration / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/deterministic/hardcoded-url | Hardcoded URL or endpoint | URL string literal in source code instead of configuration — cannot change per environment | medium | truecourse-new | config/hardcoded-url | new | all |
| code-quality/deterministic/magic-number | Magic number without named constant | Numeric literal used without explanation — should be named constant for readability and maintainability | low | truecourse-new | config/magic-number | new | all |
| code-quality/deterministic/magic-string | Magic string without named constant | String literal used as identifier/key in multiple places — should be a constant or enum | low | truecourse-new | config/magic-string | new | all |
| code-quality/deterministic/missing-env-validation | Environment variable used without validation | process.env.X used directly without checking if it's defined — undefined at runtime | high | truecourse-new | config/missing-env-validation | new | js/ts |
| code-quality/deterministic/env-in-library-code | process.env access in library/domain code | Environment variables accessed deep in business logic instead of injected via configuration | medium | truecourse-new | config/env-in-library | new | js/ts |
| code-quality/deterministic/hardcoded-port | Hardcoded port number | Server listening on hardcoded port instead of configuration — conflicts in multi-service setup | low | truecourse-new | config/hardcoded-port | new | all |
| code-quality/deterministic/todo-fixme-in-code | TODO/FIXME comment in code | Unresolved TODO or FIXME comments — technical debt that should be tracked in issue tracker | low | truecourse-new | config/todo-fixme | new | all |
| code-quality/deterministic/commented-out-code | Commented-out code blocks | Large blocks of commented-out code — should be removed (version control preserves history) | low | truecourse-new | config/commented-code | new | all |

### Configuration / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/llm/environment-specific-branch | Environment-specific conditional logic | Code branching on environment name (if prod/staging/dev) in application logic — use configuration instead | medium | truecourse-new | config/env-branch | new | all |
| code-quality/llm/missing-feature-flag | Feature deployed without feature flag | New feature shipped without feature flag — no way to disable without rollback | low | truecourse-new | config/no-feature-flag | new | all |
| code-quality/llm/inconsistent-config-pattern | Inconsistent configuration patterns | Some config via env vars, some via config files, some hardcoded — should be unified | low | truecourse-new | config/inconsistent-config | new | all |

---

## Concurrency

Rules about async operations, shared state, and parallel execution safety.

### Concurrency / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| bugs/deterministic/async-void-function | Async function returning void | Async function that is not awaited and has no error handling — fire-and-forget loses errors | high | truecourse-new | conc/async-void | new | js/ts |
| bugs/deterministic/shared-mutable-module-state | Shared mutable state in module scope | Module-level let/var that is mutated from multiple callers — unsafe in concurrent environments | high | truecourse-new | conc/shared-mutable-state | new | all |
| bugs/deterministic/global-state-mutation | Global state mutation in request handler | Modifying global/module-level variable inside request handler — shared across all concurrent requests | critical | truecourse-new | conc/global-mutation-handler | new | js/ts |
| bugs/deterministic/missing-await | Missing await on async call | Async function called without await in async context — likely a bug, not intentional fire-and-forget | high | truecourse-new | conc/missing-await | new | js/ts |
| bugs/deterministic/promise-constructor-executor-async | Async function in Promise constructor | `new Promise(async (resolve, reject) => {...})` — errors in async executor may not be caught | medium | truecourse-new | conc/async-promise-constructor | new | js/ts |

### Concurrency / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| bugs/llm/race-condition-check-then-act | Check-then-act race condition | Checking a condition then acting on it without atomicity — state may change between check and act | high | truecourse-new | conc/check-then-act | new | all |
| bugs/llm/concurrent-file-access | Concurrent file system access | Multiple async operations reading/writing same file without coordination — data corruption risk | medium | truecourse-new | conc/concurrent-file | new | all |
| bugs/llm/missing-lock-distributed | Missing distributed lock | Multiple service instances operating on shared resource without distributed locking | high | truecourse-new | conc/missing-distributed-lock | new | all |
| bugs/llm/event-ordering-assumption | Assumption about event ordering | Code assumes events arrive in specific order without guarantees — breaks under load or redelivery | medium | truecourse-new | conc/event-ordering | new | all |

---

## Security (Beyond Secrets/Injection)

Rules about authentication, authorization, data exposure, and application-level security.

### Security / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| security/deterministic/user-id-from-request-body | User ID taken from request body | Using user-supplied ID for authorization instead of extracting from authenticated session/token | critical | truecourse-new | sec/user-id-body | new | all |
| security/deterministic/password-in-log | Password or secret in log statement | Log statement includes variable named password, secret, token, apiKey, or similar | critical | truecourse-new | sec/password-in-log | new | all |
| security/deterministic/mass-assignment | Mass assignment from request body | Spreading or assigning entire req.body to database model — allows setting any field including admin/role | high | truecourse-new | sec/mass-assignment | new | all |
| security/deterministic/timing-attack-comparison | Non-constant-time string comparison for secrets | Using === to compare tokens/secrets instead of crypto.timingSafeEqual — timing attack vulnerability | medium | truecourse-new | sec/timing-attack | new | js/ts |
| security/deterministic/error-stack-in-response | Stack trace exposed in error response | error.stack sent in API response — reveals file paths, line numbers, internal structure | medium | truecourse-new | sec/stack-in-response | new | all |
| security/deterministic/user-input-in-path | User input in filesystem path | Request parameter used in file path without sanitization — path traversal vulnerability | critical | truecourse-new | sec/path-traversal | new | all |
| security/deterministic/user-input-in-redirect | User input in redirect URL | Request parameter used in redirect without validation — open redirect vulnerability | high | truecourse-new | sec/open-redirect | new | all |
| security/deterministic/missing-helmet-middleware | Express app without security headers middleware | Express application without helmet or manual security headers — missing many security defaults | medium | truecourse-new | sec/no-helmet | new | js/ts |
| security/deterministic/jwt-no-expiry | JWT token without expiry | JWT created without exp claim — token valid forever if leaked | high | truecourse-new | sec/jwt-no-expiry | new | all |
| security/deterministic/sensitive-data-in-url | Sensitive data in URL query parameter | Tokens, passwords, or PII passed in URL query string — logged in access logs and browser history | high | truecourse-new | sec/sensitive-in-url | new | all |

### Security / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| security/llm/missing-authorization-check | Missing authorization check | Endpoint verifies authentication but not authorization — any authenticated user can access any resource | critical | truecourse-new | sec/missing-authz | new | all |
| security/llm/insecure-direct-object-reference | Insecure direct object reference (IDOR) | Resource accessed by sequential/guessable ID without ownership verification | critical | truecourse-new | sec/idor | new | all |
| security/llm/privilege-escalation-path | Privilege escalation path | User can modify their own role, permissions, or access level through an API endpoint | critical | truecourse-new | sec/privilege-escalation | new | all |
| security/llm/missing-data-sanitization | Output not sanitized for context | Data rendered in HTML/SQL/shell without context-appropriate sanitization | high | truecourse-new | sec/missing-sanitization | new | all |
| security/llm/sensitive-data-in-client-state | Sensitive data stored in client-side state | Secrets, tokens, or PII stored in localStorage, sessionStorage, or Redux state — accessible to XSS | high | truecourse-new | sec/sensitive-client-state | new | js/ts |
| security/llm/missing-account-lockout | Missing account lockout on auth endpoint | Login endpoint without rate limiting or lockout after failed attempts — brute force vulnerable | medium | truecourse-new | sec/no-account-lockout | new | all |
| security/llm/excessive-data-exposure | Excessive data in API response | API returns more fields than client needs, including internal or sensitive fields | medium | truecourse-new | sec/excessive-exposure | new | all |

---

## Error Handling

Rules about robust, consistent, and informative error management.

### Error Handling / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| bugs/deterministic/generic-error-message | Generic error message | Error response says "Something went wrong" without error code or actionable detail — unhelpful for debugging | low | truecourse-new | err/generic-message | new | all |
| bugs/deterministic/error-type-any | Error caught as any/unknown without narrowing | Catch block types error as any and accesses properties without type narrowing — runtime error risk | medium | truecourse-new | err/error-type-any | new | js/ts |
| bugs/deterministic/missing-error-boundary | React component tree without error boundary | React component tree (especially with async data) without ErrorBoundary — white screen on error | medium | truecourse-new | err/no-error-boundary | new | js/ts |
| bugs/deterministic/reject-non-error | Promise rejected with non-Error value | `reject("error")` or `reject(undefined)` instead of `reject(new Error(...))` — loses stack trace | medium | truecourse-new | err/reject-non-error | new | js/ts |
| bugs/deterministic/nested-try-catch | Deeply nested try-catch blocks | Multiple levels of try-catch nesting — error handling logic is convoluted and likely wrong | low | truecourse-new | err/nested-try-catch | new | all |
| bugs/deterministic/error-swallowed-in-callback | Error parameter ignored in callback | Callback receives error parameter (err, error) but never checks or uses it | high | truecourse-new | err/ignored-callback-error | new | js/ts |

### Error Handling / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| bugs/llm/inconsistent-error-format | Inconsistent error response format | Different endpoints return errors in different shapes — {error: msg} vs {message: msg} vs {errors: [...]} | medium | truecourse-new | err/inconsistent-format | new | all |
| bugs/llm/missing-error-recovery | Missing error recovery strategy | System component fails without fallback, retry, or degraded mode — single point of failure | medium | truecourse-new | err/no-recovery | new | all |
| bugs/llm/misleading-error-message | Error message does not match actual error | Catch block returns misleading error text — confuses debugging ("user not found" when actually DB timeout) | medium | truecourse-new | err/misleading-message | new | all |
| bugs/llm/error-lost-in-transformation | Error information lost during transformation | Original error discarded when creating new error — stack trace and original cause lost | medium | truecourse-new | err/error-lost | new | all |

---

## Testing

Rules about test quality, coverage gaps, and test reliability.

### Testing / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/deterministic/test-without-assertion | Test without assertion | Test function body has no expect/assert/should call — test always passes, proves nothing | high | truecourse-new | test/no-assertion | new | all |
| code-quality/deterministic/skipped-test | Skipped test in codebase | Test marked with .skip, xit, xdescribe, @Ignore — disabled tests rot and hide regressions | medium | truecourse-new | test/skipped | new | all |
| code-quality/deterministic/test-with-hardcoded-timeout | Test relying on setTimeout for async | Test using setTimeout or sleep to wait for async operation — flaky and slow | medium | truecourse-new | test/hardcoded-timeout | new | all |
| code-quality/deterministic/test-modifying-global-state | Test modifying global state without cleanup | Test modifies env vars, global objects, or module state without afterEach cleanup — pollutes other tests | high | truecourse-new | test/global-state-leak | new | all |
| code-quality/deterministic/test-file-no-tests | Test file with no test cases | File in test directory that imports test framework but defines no test cases | low | truecourse-new | test/empty-test-file | new | all |
| code-quality/deterministic/focused-test | Focused test (.only) committed | test.only or describe.only left in codebase — prevents other tests from running in CI | critical | truecourse-new | test/focused-test | new | all |

### Testing / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/llm/tautological-test | Tautological test (always passes) | Test asserts on mocked return value or static data — tests the mock, not the code | medium | truecourse-new | test/tautological | new | all |
| code-quality/llm/excessive-mocking | Test with excessive mocking | Test mocks so many dependencies that it tests nothing real — change in implementation won't break test | medium | truecourse-new | test/excessive-mocking | new | all |
| code-quality/llm/missing-edge-case-tests | Missing edge case test coverage | Tests only cover happy path — no tests for empty input, null, boundary values, error cases | medium | truecourse-new | test/missing-edge-cases | new | all |
| code-quality/llm/test-implementation-coupling | Test coupled to implementation details | Test asserts on internal implementation (private methods, internal state) rather than behavior — breaks on refactor | medium | truecourse-new | test/impl-coupling | new | all |
| code-quality/llm/missing-integration-test | Missing integration test for critical path | Critical user-facing flow only tested with unit tests, no integration/e2e test | medium | truecourse-new | test/missing-integration | new | all |
| code-quality/llm/non-deterministic-test | Non-deterministic test | Test depends on current time, random values, or external service without mocking — intermittent failure | high | truecourse-new | test/non-deterministic | new | all |

---

## Code Architecture

Rules about structural quality, coupling, cohesion, and design patterns.

### Code Architecture / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| architecture/deterministic/function-too-many-params | Function with too many parameters | Function accepting more than 5 parameters — should use options/config object | medium | truecourse-new | arch/too-many-params | new | all |
| architecture/deterministic/deeply-nested-code | Deeply nested control flow | Code nested 4+ levels of if/for/while/try — hard to read and reason about | medium | truecourse-new | arch/deep-nesting | new | all |
| architecture/deterministic/function-too-long | Function exceeding reasonable length | Function body longer than ~100 lines — likely doing too much, should be decomposed | medium | truecourse-new | arch/function-too-long | new | all |
| architecture/deterministic/file-too-long | File exceeding reasonable length | Source file longer than ~500 lines — likely has multiple responsibilities | low | truecourse-new | arch/file-too-long | new | all |
| architecture/deterministic/class-too-many-methods | Class with too many public methods | Class exposing more than 15 public methods — interface too large, violates ISP | medium | truecourse-new | arch/too-many-methods | new | all |
| architecture/deterministic/boolean-parameter | Boolean parameter in public function | Public function taking boolean to switch behavior — should be two separate functions | low | truecourse-new | arch/boolean-param | new | all |
| architecture/deterministic/callback-hell | Callback nesting depth | Callbacks nested 3+ levels deep — should use Promises or async/await | medium | truecourse-new | arch/callback-hell | new | js/ts |
| architecture/deterministic/type-assertion-overuse | Excessive type assertions | Heavy use of `as Type` or `!` non-null assertions — bypassing TypeScript safety | medium | truecourse-new | arch/type-assertion-overuse | new | js/ts |
| architecture/deterministic/any-type-usage | Using 'any' type in TypeScript | Variable, parameter, or return type explicitly typed as 'any' — defeats type safety | medium | truecourse-new | arch/any-type | new | js/ts |
| architecture/deterministic/duplicate-code-block | Duplicated code block | Near-identical code blocks appearing in multiple locations — should be extracted to shared function | medium | truecourse-new | arch/duplicate-code | new | all |
| architecture/deterministic/barrel-file-re-export-all | Barrel file re-exporting everything | index.ts re-exports entire module tree — bloats bundle size, circular dependency risk, slow IDE | low | truecourse-new | arch/barrel-reexport-all | new | js/ts |

### Code Architecture / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| architecture/llm/feature-envy | Feature envy | Method primarily uses data from another class/module — logic should move to where the data lives | medium | truecourse-new | arch/feature-envy | new | all |
| architecture/llm/shotgun-surgery | Shotgun surgery | Single logical change requires modifying many files across the codebase — poor encapsulation | medium | truecourse-new | arch/shotgun-surgery | new | all |
| architecture/llm/divergent-change | Divergent change | Single file/class modified for many unrelated reasons — violates single responsibility | medium | truecourse-new | arch/divergent-change | new | all |
| architecture/llm/inappropriate-intimacy | Inappropriate intimacy between modules | Two modules accessing each other's internals instead of public interfaces — high coupling | medium | truecourse-new | arch/inappropriate-intimacy | new | all |
| architecture/llm/middleman-class | Middleman class | Class that only delegates to another class without adding value — unnecessary indirection | low | truecourse-new | arch/middleman | new | all |
| architecture/llm/god-function | God function orchestrating everything | Single function handling validation, business logic, persistence, and notification — should be decomposed | high | truecourse-new | arch/god-function | new | all |
| architecture/llm/primitive-obsession | Primitive obsession | Using primitive types (string, number) for domain concepts (email, money, userId) — no validation or behavior | low | truecourse-new | arch/primitive-obsession | new | all |
| architecture/llm/leaky-abstraction | Leaky abstraction | Abstraction layer that exposes implementation details — callers depend on internal behavior | medium | truecourse-new | arch/leaky-abstraction | new | all |
| architecture/llm/missing-abstraction | Missing abstraction layer | Business logic directly calling infrastructure (DB, HTTP, file system) without service/repository layer | medium | truecourse-new | arch/missing-abstraction | new | all |
| architecture/llm/temporal-coupling | Temporal coupling | Functions that must be called in specific order without the code enforcing that order | medium | truecourse-new | arch/temporal-coupling | new | all |
| architecture/llm/hardcoded-business-rule | Hardcoded business rule | Business rule embedded in code instead of being configurable or data-driven | low | truecourse-new | arch/hardcoded-business-rule | new | all |

---

## Dependency Management

Rules about package dependencies, versioning, and supply chain.

### Dependency Management / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/deterministic/deprecated-api-usage | Using deprecated API | Calling function, method, or property marked @deprecated — will break in future version | medium | truecourse-new | dep/deprecated-api | new | all |
| code-quality/deterministic/unpinned-dependency | Unpinned dependency version | Dependency using ^ or ~ range in production — builds may break from minor/patch updates | low | truecourse-new | dep/unpinned-version | new | js/ts |
| code-quality/deterministic/dev-dependency-in-production | Dev dependency imported in production code | Package listed in devDependencies but imported in src/ code — missing in production install | high | truecourse-new | dep/dev-in-prod | new | js/ts |
| code-quality/deterministic/multiple-versions-same-package | Multiple versions of same package | Lock file shows multiple versions of same package — bundle bloat and potential behavior differences | low | truecourse-new | dep/duplicate-package | new | js/ts |
| code-quality/deterministic/missing-lockfile | Missing lock file | Project has package.json but no package-lock.json or pnpm-lock.yaml — non-reproducible builds | medium | truecourse-new | dep/no-lockfile | new | js/ts |

### Dependency Management / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/llm/unnecessary-dependency | Unnecessary third-party dependency | Package used for trivial functionality easily implemented in a few lines — unnecessary supply chain risk | low | truecourse-new | dep/unnecessary | new | all |
| code-quality/llm/abandoned-dependency | Dependency appears unmaintained | Package with no updates in 2+ years, many open issues, or deprecated notices — should find alternative | medium | truecourse-new | dep/abandoned | new | all |
| code-quality/llm/overlapping-dependencies | Multiple packages for same purpose | Two or more packages providing same functionality (moment + dayjs, lodash + ramda) — pick one | low | truecourse-new | dep/overlapping | new | all |

---

## Database

Rules about schema design, query patterns, and data access.

### Database / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| database/deterministic/select-star | SELECT * in production code | Fetching all columns when only subset needed — wastes bandwidth, breaks on schema change | medium | truecourse-new | db/select-star | new | all |
| database/deterministic/missing-migration | Schema change without migration file | Direct ALTER TABLE or schema modification not captured in migration system | high | truecourse-new | db/no-migration | new | all |
| database/deterministic/connection-not-released | Database connection not released | Connection acquired from pool but not released in finally/using block — connection pool exhaustion | high | truecourse-new | db/connection-leak | new | all |
| database/deterministic/orm-lazy-load-in-loop | ORM lazy loading in loop | Accessing ORM relationship inside loop triggers individual query per iteration — N+1 pattern | high | truecourse-new | db/orm-lazy-loop | new | all |
| database/deterministic/hardcoded-connection-string | Hardcoded database connection string | Database connection string or credentials in source code instead of environment config | critical | truecourse-new | db/hardcoded-connection | new | all |

### Database / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| database/llm/missing-index-on-foreign-key | Missing index on foreign key column | Foreign key column without index — JOIN and CASCADE operations scan full table | medium | truecourse-new | db/fk-no-index | new | all |
| database/llm/denormalization-without-sync | Denormalized data without sync mechanism | Data duplicated across tables without triggers, events, or application logic to keep in sync | medium | truecourse-new | db/denorm-no-sync | new | all |
| database/llm/query-in-transaction-too-long | Long-running transaction | Transaction holding locks while doing external calls or heavy processing — blocks other operations | high | truecourse-new | db/long-transaction | new | all |
| database/llm/missing-created-updated-timestamps | Table missing audit timestamps | Database table without created_at/updated_at columns — no audit trail for record changes | low | truecourse-new | db/no-timestamps | new | all |

---

## React / Frontend Specific

Rules about React patterns, state management, and frontend architecture.

### React / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| bugs/deterministic/usestate-object-mutation | Direct mutation of React state object | Mutating state object directly instead of creating new reference — React won't detect the change | high | truecourse-new | react/state-mutation | new | js/ts |
| bugs/deterministic/useeffect-missing-deps | useEffect with missing dependency | useEffect references variable not in dependency array — stale closure bug | high | truecourse-new | react/missing-deps | new | js/ts |
| bugs/deterministic/useeffect-object-dep | Object/array in useEffect dependency array | Object or array literal in useEffect deps — new reference every render, infinite loop | high | truecourse-new | react/object-dep | new | js/ts |
| bugs/deterministic/conditional-hook | Hook called conditionally | useState/useEffect/useMemo called inside if/for/early-return — violates rules of hooks | critical | truecourse-new | react/conditional-hook | new | js/ts |
| bugs/deterministic/set-state-in-render | setState called during render | Calling setState directly in component body (not in effect or handler) — infinite re-render loop | critical | truecourse-new | react/set-state-render | new | js/ts |
| performance/deterministic/missing-react-memo | Component receiving unchanged props re-renders | Pure display component without React.memo receiving same props from parent re-render | low | truecourse-new | react/missing-memo | new | js/ts |
| performance/deterministic/unnecessary-context-provider | Context provider value changes on every render | Context value is new object/array each render — all consumers re-render every time | medium | truecourse-new | react/context-new-ref | new | js/ts |

### React / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| architecture/llm/component-too-many-responsibilities | Component with too many responsibilities | Single React component handling data fetching, business logic, and complex UI — should be split | medium | truecourse-new | react/component-god | new | js/ts |
| architecture/llm/prop-drilling-deep | Deep prop drilling | Prop passed through 3+ intermediate components that don't use it — use context or composition | medium | truecourse-new | react/prop-drilling | new | js/ts |
| architecture/llm/business-logic-in-component | Business logic in React component | Complex business rules in component instead of custom hook or service — not reusable or testable | medium | truecourse-new | react/logic-in-component | new | js/ts |
| architecture/llm/mixed-data-fetching-patterns | Inconsistent data fetching patterns | Mix of useEffect+fetch, React Query, SWR, and direct axios in same app — should standardize | low | truecourse-new | react/mixed-fetching | new | js/ts |

---

## Node.js / Backend Specific

Rules about Node.js server patterns, Express/Fastify, and backend architecture.

### Node.js / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| reliability/deterministic/express-async-no-wrapper | Async Express handler without error wrapper | Async route handler without try-catch or express-async-errors — unhandled rejection crashes server | high | truecourse-new | node/async-handler-unwrapped | new | js/ts |
| reliability/deterministic/missing-next-on-error | Express middleware not calling next(err) | Middleware catches error but doesn't call next(err) — error handler middleware never invoked | medium | truecourse-new | node/missing-next-error | new | js/ts |
| security/deterministic/express-trust-proxy-not-set | Missing trust proxy configuration | Express behind reverse proxy without app.set('trust proxy') — req.ip shows proxy IP, not client | medium | truecourse-new | node/no-trust-proxy | new | js/ts |
| performance/deterministic/sync-require-in-handler | Dynamic require() in request handler | require() inside request handler — synchronous file read on every request, blocks event loop | medium | truecourse-new | node/sync-require-handler | new | js/ts |
| reliability/deterministic/uncaught-exception-no-handler | No uncaughtException/unhandledRejection handler | Node.js process without global error handlers — crashes silently on unexpected errors | high | truecourse-new | node/no-global-error-handler | new | js/ts |
| reliability/deterministic/stream-no-error-handler | Stream without error handler | Readable/Writable stream created without 'error' event listener — unhandled error crashes process | high | truecourse-new | node/stream-no-error | new | js/ts |

### Node.js / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| architecture/llm/middleware-order-incorrect | Incorrect Express middleware ordering | Auth middleware after route handlers, body parser after routes, or CORS after routes — middleware not applied | high | truecourse-new | node/middleware-order | new | js/ts |
| architecture/llm/monolithic-route-handler | Monolithic route handler | Single route handler doing validation, auth, business logic, DB access, and response formatting — should use middleware chain | medium | truecourse-new | node/monolithic-handler | new | js/ts |
| reliability/llm/missing-request-timeout | Missing server-level request timeout | HTTP server without request timeout — slow clients can hold connections open indefinitely | medium | truecourse-new | node/no-request-timeout | new | js/ts |

---

## Summary

| Domain | Deterministic | LLM | Total |
|--------|--------------|-----|-------|
| Performance | 17 | 10 | 27 |
| Reliability | 15 | 10 | 25 |
| API Design | 7 | 7 | 14 |
| Observability | 4 | 6 | 10 |
| Data Integrity | 6 | 6 | 12 |
| Configuration | 8 | 3 | 11 |
| Concurrency | 5 | 4 | 9 |
| Security (beyond secrets) | 10 | 7 | 17 |
| Error Handling | 6 | 4 | 10 |
| Testing | 6 | 6 | 12 |
| Code Architecture | 11 | 11 | 22 |
| Dependency Management | 5 | 3 | 8 |
| Database | 5 | 4 | 9 |
| React / Frontend | 7 | 4 | 11 |
| Node.js / Backend | 6 | 3 | 9 |
| **Total** | **118** | **88** | **206** |
