# TrueCourse Master Rule Catalog

> Consolidated from: ESLint core, @typescript-eslint, SonarJS (eslint-plugin-sonarjs), Gitleaks, Ruff (flake8-bandit, flake8-bugbear, Pylint, etc.), SonarPython, existing TrueCourse rules, and TrueCourse engineering rules.
> Generated: 2026-04-02
>
> **Rule key format:** `{domain}/{detection}/{name}`
> **Domains:** architecture, security, bugs, code-quality, database, performance, reliability
> **Detection:** deterministic, llm
>
> Filtering applied:
> - Deprecated rules from all sources are EXCLUDED
> - Formatting/stylistic, naming convention, and docstring rules are INCLUDED (consolidated into grouped entries)
> - Duplicate checks across ESLint/SonarJS/Ruff/SonarPython are merged into single entries
> - All 222 Gitleaks service-specific secret patterns are consolidated under a single rule with notes

---

## Architecture

Rules about service boundaries, layers, dependencies, coupling, dead code at module level.

### Architecture / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| architecture/deterministic/circular-service-dependency | Circular service dependency | Two services depend on each other, creating a circular dependency | high | truecourse-existing | arch/circular-service-dependency | existing | all |
| architecture/deterministic/god-service | God service | Service has too many files or spans too many layers, suggesting too many responsibilities | medium | truecourse-existing | arch/god-service | existing | all |
| architecture/deterministic/data-layer-depends-on-api | Data layer depends on API layer | Data layer should not import from the API layer | high | truecourse-existing | arch/module-layer-data-api | existing | all |
| architecture/deterministic/external-layer-depends-on-api | External layer depends on API layer | External integrations should not depend on the API layer directly | medium | truecourse-existing | arch/module-layer-external-api | existing | all |
| architecture/deterministic/data-layer-depends-on-external | Data layer depends on external layer | Data layer should not call external services | medium | truecourse-existing | arch/module-layer-data-external | existing | all |
| architecture/deterministic/cross-service-internal-import | Cross-service internal import | Module imports from another service's internal layer instead of its API | high | truecourse-existing | arch/cross-service-internal-import | existing | all |
| architecture/deterministic/god-module | God module | Class or module has too many methods (>15), suggesting too many responsibilities | medium | truecourse-existing | arch/god-module | existing | all |
| architecture/deterministic/unused-export | Unused export | Exported function or class not imported anywhere in the codebase | low | truecourse-existing | arch/unused-export | existing | all |
| architecture/deterministic/dead-module | Dead module | Module has no incoming or outgoing dependencies — likely unused | low | truecourse-existing | arch/dead-module | existing | all |
| architecture/deterministic/orphan-file | Orphan file | Source file is never imported by any other file in the codebase | low | truecourse-existing | arch/orphan-file | existing | all |
| architecture/deterministic/wildcard-import | Wildcard import | import * or from x import * pollutes namespace and defeats tree-shaking | low | truecourse-existing, sonarjs, eslint | code/star-import, S2208, no-wildcard-import | existing | js/ts, python |
| architecture/deterministic/duplicate-import | Duplicate import | Same module imported multiple times in a single file | low | eslint | no-duplicate-imports | new | js/ts |
| architecture/deterministic/implicit-dependency | Implicit dependency | Module uses a dependency not declared in package.json | medium | sonarjs | S4328 (no-implicit-dependencies) | new | js/ts |
| architecture/deterministic/declarations-in-global-scope | Declarations in global scope | Variables and functions should not be declared in the global scope | medium | sonarjs | S3798 (declarations-in-global-scope) | new | js/ts |
| architecture/deterministic/unused-import | Unused import | Import statement that is never referenced in the file | low | sonarjs, sonar-python, ruff | S1128, F401 (UnusedImport) | new | all |
| architecture/deterministic/missing-input-validation | Missing input validation on API endpoint | Route handler accesses req.body/req.params/req.query without validation (Zod, Joi, etc.) | high | truecourse | - | new | js/ts |
| architecture/deterministic/missing-pagination-endpoint | List endpoint without pagination | GET endpoint returning array without limit/offset/cursor parameters — unbounded response | high | truecourse | - | new | all |
| architecture/deterministic/missing-error-status-code | Catch block sending 200 on error | Error caught but response sent with 200 status — clients cannot distinguish success from failure | high | truecourse | - | new | all |
| architecture/deterministic/route-without-auth-middleware | Route without authentication middleware | Express/Fastify route registered without auth middleware on non-public path | high | truecourse | - | new | js/ts |
| architecture/deterministic/missing-rate-limiting | No rate limiting middleware | API application with no rate limiting middleware registered — vulnerable to abuse | medium | truecourse | - | new | js/ts |
| architecture/deterministic/missing-request-body-size-limit | No request body size limit | Express/body-parser configured without body size limit — denial of service via large payloads | medium | truecourse, sonarjs | -, S5693 | new | js/ts |
| architecture/deterministic/raw-error-in-response | Raw error object in API response | Sending error.message or error.stack directly in response — leaks implementation details | medium | truecourse | - | new | all |
| architecture/deterministic/type-assertion-overuse | Excessive type assertions | Heavy use of `as Type` or `!` non-null assertions — bypassing TypeScript safety | medium | truecourse | - | new | js/ts |
| architecture/deterministic/barrel-file-re-export-all | Barrel file re-exporting everything | index.ts re-exports entire module tree — bloats bundle size, circular dependency risk, slow IDE | low | truecourse | - | new | js/ts |

### Architecture / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| architecture/llm/tight-coupling | Tightly coupled service pair | Two services with unusually high cross-dependencies that may need merging | medium | truecourse-existing | llm/arch-tight-coupling | existing | all |
| architecture/llm/missing-layers | Service missing expected layers | Service lacks expected architectural layers for its type (e.g., API server without service layer) | low | truecourse-existing | llm/arch-missing-layers | existing | all |
| architecture/llm/circular-module-dependency | Circular module dependency | Circular import chains between modules within the same service | high | truecourse-existing | llm/arch-circular-module-dependency | existing | all |
| architecture/llm/deep-inheritance-chain | Deep inheritance chain | Class extending 3+ levels deep, making code fragile | medium | truecourse-existing | llm/arch-deep-inheritance-chain | existing | all |
| architecture/llm/excessive-fan-out | Excessive fan-out | Module importing too many other modules (>8-10) | medium | truecourse-existing | llm/arch-excessive-fan-out | existing | all |
| architecture/llm/excessive-fan-in | Excessive fan-in | Module imported by disproportionately many others (bottleneck) | medium | truecourse-existing | llm/arch-excessive-fan-in | existing | all |
| architecture/llm/mixed-abstraction-levels | Mixed abstraction levels | Method mixing high-level orchestration with low-level details | low | truecourse-existing | llm/arch-mixed-abstraction-levels | existing | all |
| architecture/llm/inconsistent-response-format | Inconsistent API response format | Endpoints return data in different shapes (some wrapped, some not, different error formats) | medium | truecourse | - | new | all |
| architecture/llm/breaking-api-change | Breaking API contract change | Endpoint removes or renames fields, changes types, or alters behavior without versioning | high | truecourse | - | new | all |
| architecture/llm/missing-api-versioning | Missing API versioning | Public API without version prefix (/v1/) — no path for backward-compatible evolution | medium | truecourse | - | new | all |
| architecture/llm/over-exposed-internal-model | Internal data model exposed in API | Database schema or internal object structure leaked directly in API response — coupling clients to internals | medium | truecourse | - | new | all |
| architecture/llm/chatty-api | Chatty API requiring many round trips | Client needs multiple sequential API calls to accomplish single logical operation — should be combined | medium | truecourse | - | new | all |
| architecture/llm/wrong-http-method | Incorrect HTTP method for operation | Using GET for mutations or POST for idempotent reads — violates REST semantics | low | truecourse | - | new | all |
| architecture/llm/missing-api-error-documentation | Undocumented error responses | API endpoint can return error codes not documented or not typed — clients cannot handle them | low | truecourse | - | new | all |
| architecture/llm/feature-envy | Feature envy | Method primarily uses data from another class/module — logic should move to where the data lives | medium | truecourse | - | new | all |
| architecture/llm/shotgun-surgery | Shotgun surgery | Single logical change requires modifying many files across the codebase — poor encapsulation | medium | truecourse | - | new | all |
| architecture/llm/divergent-change | Divergent change | Single file/class modified for many unrelated reasons — violates single responsibility | medium | truecourse | - | new | all |
| architecture/llm/inappropriate-intimacy | Inappropriate intimacy between modules | Two modules accessing each other's internals instead of public interfaces — high coupling | medium | truecourse | - | new | all |
| architecture/llm/middleman-class | Middleman class | Class that only delegates to another class without adding value — unnecessary indirection | low | truecourse | - | new | all |
| architecture/llm/god-function | God function orchestrating everything | Single function handling validation, business logic, persistence, and notification — common in route handlers | high | truecourse | - | new | all |
| architecture/llm/primitive-obsession | Primitive obsession | Using primitive types (string, number) for domain concepts (email, money, userId) — no validation or behavior | low | truecourse | - | new | all |
| architecture/llm/leaky-abstraction | Leaky abstraction | Abstraction layer that exposes implementation details — callers depend on internal behavior | medium | truecourse | - | new | all |
| architecture/llm/missing-abstraction | Missing abstraction layer | Business logic directly calling infrastructure (DB, HTTP, file system) without service/repository layer | medium | truecourse | - | new | all |
| architecture/llm/temporal-coupling | Temporal coupling | Functions that must be called in specific order without the code enforcing that order | medium | truecourse | - | new | all |
| architecture/llm/hardcoded-business-rule | Hardcoded business rule | Business rule embedded in code instead of being configurable or data-driven | low | truecourse | - | new | all |
| architecture/llm/component-too-many-responsibilities | Component with too many responsibilities | Single React component handling data fetching, business logic, and complex UI — should be split | medium | truecourse | - | new | js/ts |
| architecture/llm/prop-drilling-deep | Deep prop drilling | Prop passed through 3+ intermediate components that don't use it — use context or composition | medium | truecourse | - | new | js/ts |
| architecture/llm/business-logic-in-component | Business logic in React component | Complex business rules in component instead of custom hook or service — not reusable or testable | medium | truecourse | - | new | js/ts |
| architecture/llm/mixed-data-fetching-patterns | Inconsistent data fetching patterns | Mix of useEffect+fetch, React Query, SWR, and direct axios in same app — should standardize | low | truecourse | - | new | js/ts |
| architecture/llm/middleware-order-incorrect | Incorrect Express middleware ordering | Auth middleware after route handlers, body parser after routes, or CORS after routes — middleware not applied | high | truecourse | - | new | js/ts |

---

## Security

Rules about secrets, injection, XSS, CSRF, crypto, authentication, permissions.

### Security / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| security/deterministic/hardcoded-secret | Hardcoded secret | String literal matches known API key, token, or password patterns. Covers all 222 Gitleaks service-specific patterns (AWS, GitHub, Slack, Stripe, etc.) plus SonarJS credential detection. | critical | truecourse-existing, gitleaks, sonarjs | code/hardcoded-secret, all 222 gitleaks rules, S2068 (no-hardcoded-passwords), S6418 (no-hardcoded-secrets), S6437 (hardcoded-secret-signatures) | existing | all |
| security/deterministic/sql-injection | Unsafe SQL query | Template literal or string concatenation passed to a query method instead of parameterized queries | high | truecourse-existing, sonarjs | code/sql-injection, S2077 (sql-queries) | existing | js/ts, python |
| security/deterministic/hardcoded-ip | Hardcoded IP address | Using hardcoded IP addresses instead of configuration | medium | sonarjs, sonar-python | S1313 (no-hardcoded-ip) | new | all |
| security/deterministic/eval-usage | Dynamic code evaluation | Use of eval(), exec(), or equivalent dynamic code execution | high | sonarjs, eslint, ruff | S1523 (code-eval), no-eval, no-implied-eval, no-new-func, S102 (ExecBuiltin), S307 (SuspiciousEvalUsage), PGH001 (Eval) | new | all |
| security/deterministic/insecure-cookie | Cookie without secure flag | Creating cookies without the "secure" flag | high | sonarjs, sonar-python | S2092 (insecure-cookie) | new | all |
| security/deterministic/cookie-without-httponly | Cookie without HttpOnly flag | Creating cookies without the "HttpOnly" flag | high | sonarjs, sonar-python | S3330 (cookie-no-httponly) | new | all |
| security/deterministic/permissive-cors | Permissive CORS policy | Having a permissive Cross-Origin Resource Sharing policy | high | sonarjs, sonar-python | S5122 (cors) | new | all |
| security/deterministic/csrf-disabled | CSRF protection disabled | Disabling CSRF protections in web framework | high | sonarjs, sonar-python | S4502 (csrf) | new | all |
| security/deterministic/weak-cipher | Weak cipher algorithm | Using cipher algorithms that are not considered robust | high | sonarjs, sonar-python, ruff | S5547 (no-weak-cipher), S304 (SuspiciousInsecureCipherUsage), S305 (SuspiciousInsecureCipherModeUsage) | new | all |
| security/deterministic/weak-hashing | Weak hashing algorithm | Using weak hashing algorithms (MD5, SHA1) for security purposes | high | sonarjs, sonar-python, ruff | S4790 (hashing), S303 (SuspiciousInsecureHashUsage), S324 (HashlibInsecureHashFunction) | new | all |
| security/deterministic/weak-crypto-key | Weak cryptographic key | Cryptographic key size is too small to be secure | high | sonarjs, sonar-python, ruff | S4426 (no-weak-keys), S505 (WeakCryptographicKey) | new | all |
| security/deterministic/weak-ssl | Weak SSL/TLS protocol | Using outdated SSL/TLS protocol versions | high | sonarjs, sonar-python, ruff | S4423 (weak-ssl), S502 (SslInsecureVersion), S503 (SslWithBadDefaults) | new | all |
| security/deterministic/insecure-jwt | Insecure JWT token | JWT signed or verified with weak cipher algorithm | high | sonarjs, sonar-python | S5659 (insecure-jwt-token) | new | all |
| security/deterministic/encryption-insecure-mode | Insecure encryption mode | Encryption using insecure mode or padding scheme | high | sonarjs, sonar-python | S5542 (encryption-secure-mode), S3329 (cipher-block-chaining-iv) | new | all |
| security/deterministic/clear-text-protocol | Clear-text protocol | Using unencrypted HTTP, FTP, or other clear-text protocols | medium | sonarjs, sonar-python, ruff | S5332 (no-clear-text-protocols), S321 (SuspiciousFTPLibUsage), S312 (SuspiciousTelnetUsage) | new | all |
| security/deterministic/disabled-auto-escaping | Disabled auto-escaping | Disabling auto-escaping in template engines (XSS risk) | high | sonarjs, sonar-python, ruff | S5247 (disabled-auto-escaping), S701 (Jinja2AutoescapeFalse), S702 (MakoTemplates) | new | all |
| security/deterministic/missing-content-security-policy | Missing content security policy | Disabling content security policy fetch directives | medium | sonarjs | S5728 (content-security-policy) | new | js/ts |
| security/deterministic/missing-frame-ancestors | Missing frame-ancestors directive | Disabling content security policy frame-ancestors directive (clickjacking risk) | medium | sonarjs | S5732 (frame-ancestors) | new | js/ts |
| security/deterministic/missing-strict-transport | Missing strict transport security | Disabling Strict-Transport-Security header | medium | sonarjs | S5739 (strict-transport-security) | new | js/ts |
| security/deterministic/missing-referrer-policy | Missing referrer policy | Disabling strict HTTP no-referrer policy | medium | sonarjs | S5736 (no-referrer-policy) | new | js/ts |
| security/deterministic/missing-mime-sniff-protection | MIME sniffing allowed | Allowing browsers to sniff MIME types | medium | sonarjs | S5734 (no-mime-sniff) | new | js/ts |
| security/deterministic/server-fingerprinting | Server fingerprinting | X-Powered-By header discloses server technology | low | sonarjs | S5689 (x-powered-by) | new | js/ts |
| security/deterministic/unverified-certificate | Unverified server certificate | Server certificates should be verified during SSL/TLS connections | high | sonarjs, sonar-python, ruff | S4830 (unverified-certificate), S501 (RequestWithNoCertValidation), S323 (SuspiciousUnverifiedContextUsage) | new | all |
| security/deterministic/unverified-hostname | Unverified hostname | Server hostnames should be verified during SSL/TLS connections | high | sonarjs, sonar-python | S5527 (unverified-hostname) | new | all |
| security/deterministic/xml-xxe | XML external entity attack | XML parsers should not be vulnerable to XXE attacks | high | sonarjs, sonar-python, ruff | S2755 (xml-parser-xxe), S313-S320 (SuspiciousXML*Usage) | new | all |
| security/deterministic/unsafe-unzip | Unsafe archive extraction | Expanding archive files without controlling resource consumption (zip bomb) | high | sonarjs, sonar-python, ruff | S5042 (no-unsafe-unzip), S202 (TarfileUnsafeMembers) | new | all |
| security/deterministic/os-command-injection | OS command injection | Using shell interpreter when executing OS commands | critical | sonarjs, ruff | S4721 (os-command), S602 (SubprocessPopenWithShellEqualsTrue), S604 (CallWithShellEqualsTrue), S605 (StartProcessWithAShell) | new | all |
| security/deterministic/file-permissions-world-accessible | World-accessible file permissions | File permissions should not be set to world-accessible values | high | sonarjs, sonar-python, ruff | S2612 (file-permissions), S103 (BadFilePermissions) | new | all |
| security/deterministic/unrestricted-file-upload | Unrestricted file upload | File uploads should be restricted by type and size | medium | sonarjs | S2598 (file-uploads) | new | js/ts |
| security/deterministic/hidden-file-exposure | Hidden file exposure | Statically serving hidden files is security-sensitive | medium | sonarjs | S5691 (hidden-files) | new | js/ts |
| security/deterministic/unverified-cross-origin-message | Unverified cross-origin message | Origins should be verified during cross-origin communications | medium | sonarjs | S2819 (post-message) | new | js/ts |
| security/deterministic/link-target-blank | Unsafe target blank | Opened window can access back to originating window via window.opener | low | sonarjs | S5148 (link-with-target-blank) | new | js/ts |
| security/deterministic/intrusive-permissions | Intrusive permissions | Using intrusive browser/device permissions | medium | sonarjs | S5604 (no-intrusive-permissions) | new | js/ts |
| security/deterministic/confidential-info-logging | Confidential information logging | Allowing confidential information to be logged | medium | sonarjs | S5757 (confidential-information-logging) | new | js/ts |
| security/deterministic/production-debug-enabled | Debug mode in production | Delivering code in production with debug features activated (e.g., Flask debug=True) | medium | sonarjs, sonar-python, ruff | S4507 (production-debug), S201 (FlaskDebugTrue) | new | all |
| security/deterministic/insecure-random | Insecure random number generator | Using Math.random(), random.random(), or equivalent PRNG for security-sensitive operations | medium | sonarjs, sonar-python, ruff | S2245 (pseudo-random), S311 (SuspiciousNonCryptographicRandomUsage) | new | all |
| security/deterministic/session-not-regenerated | Session not regenerated | A new session should be created during user authentication | medium | sonarjs | S5876 (session-regeneration) | new | js/ts |
| security/deterministic/ip-forwarding | IP forwarding | Forwarding client IP address is security-sensitive | low | sonarjs | S5759 (no-ip-forward) | new | js/ts |
| security/deterministic/publicly-writable-directory | Publicly writable directory | Using publicly writable directories for sensitive operations | medium | sonarjs, sonar-python, ruff | S5443 (publicly-writable-directories), S108 (HardcodedTempFile) | new | all |
| security/deterministic/hardcoded-blockchain-mnemonic | Hardcoded wallet phrase | Wallet/mnemonic phrases should not be hard-coded | critical | sonarjs | S7639 (review-blockchain-mnemonic) | new | js/ts |
| security/deterministic/dompurify-unsafe-config | DOMPurify bypass | DOMPurify configuration should not be bypassable | high | sonarjs | S8479 (dompurify-unsafe-config) | new | js/ts |
| security/deterministic/disabled-resource-integrity | Missing subresource integrity | Using remote artifacts without integrity checks | medium | sonarjs | S5725 (disabled-resource-integrity) | new | js/ts |
| security/deterministic/dynamically-constructed-template | Dynamically constructed template | Templates should not be constructed dynamically (template injection) | high | sonarjs | S7790 (dynamically-constructed-templates) | new | js/ts |
| security/deterministic/angular-sanitization-bypass | Angular sanitization bypass | Disabling Angular built-in sanitization | high | sonarjs | S6268 (no-angular-bypass-sanitization) | new | js/ts |
| security/deterministic/path-command-injection | Path command injection | Searching OS commands in PATH is security-sensitive | high | sonarjs | S4036 | new | js/ts |
| security/deterministic/mixed-content | Mixed content | Allowing mixed HTTP/HTTPS content downgrades security | medium | sonarjs | S5730 | new | js/ts |
| security/deterministic/session-cookie-on-static | Session cookie on static | Static assets serving session cookies | medium | sonarjs | S8441 | new | js/ts |
| security/deterministic/user-id-from-request-body | User ID taken from request body | Using user-supplied ID for authorization instead of extracting from authenticated session/token | critical | truecourse | - | new | all |
| security/deterministic/mass-assignment | Mass assignment from request body | Spreading or assigning entire req.body to database model — allows setting any field including admin/role | high | truecourse | - | new | all |
| security/deterministic/timing-attack-comparison | Non-constant-time string comparison for secrets | Using === to compare tokens/secrets instead of crypto.timingSafeEqual — timing attack vulnerability | medium | truecourse | - | new | js/ts |
| security/deterministic/user-input-in-path | User input in filesystem path | Request parameter used in file path without sanitization — path traversal vulnerability | critical | truecourse | - | new | all |
| security/deterministic/user-input-in-redirect | User input in redirect URL | Request parameter used in redirect without validation — open redirect vulnerability | high | truecourse | - | new | all |
| security/deterministic/missing-helmet-middleware | Express app without security headers middleware | Express application without helmet or manual security headers — missing many security defaults | medium | truecourse | - | new | js/ts |
| security/deterministic/jwt-no-expiry | JWT token without expiry | JWT created without exp claim — token valid forever if leaked | high | truecourse | - | new | all |
| security/deterministic/sensitive-data-in-url | Sensitive data in URL query parameter | Tokens, passwords, or PII passed in URL query string — logged in access logs and browser history | high | truecourse | - | new | all |
| security/deterministic/express-trust-proxy-not-set | Missing trust proxy configuration | Express behind reverse proxy without app.set('trust proxy') — req.ip shows proxy IP, not client | medium | truecourse | - | new | js/ts |
| security/deterministic/hardcoded-password-function-arg | Hardcoded password in function argument | Password or secret passed as string literal to function parameter named password/secret/token | high | ruff | S105 (HardcodedPasswordString), S106 (HardcodedPasswordFuncArg), S107 (HardcodedPasswordDefault) | new | python |
| security/deterministic/unsafe-yaml-load | Unsafe YAML load | Using yaml.load() without SafeLoader allows arbitrary code execution | critical | ruff | S506 (UnsafeYAMLLoad) | new | python |
| security/deterministic/unsafe-pickle-usage | Unsafe pickle/marshal usage | Using pickle.loads/marshal.loads on untrusted data allows arbitrary code execution | critical | ruff | S301 (SuspiciousPickleUsage), S302 (SuspiciousMarshalUsage) | new | python |
| security/deterministic/ssh-no-host-key-verification | SSH without host key verification | SSH connection configured to skip host key verification — MITM attack risk | high | ruff | S507 (SSHNoHostKeyVerification) | new | python |
| security/deterministic/unsafe-temp-file | Insecure temporary file creation | Using mktemp() or predictable temp file patterns instead of mkstemp()/NamedTemporaryFile | high | ruff, sonar-python | S306 (SuspiciousMktempUsage), S5445 | new | python |
| security/deterministic/hardcoded-database-password | Database connection without secure password | Connecting to database with empty or hardcoded password | critical | sonar-python | S2115 | new | python |
| security/deterministic/ldap-unauthenticated | Unauthenticated LDAP connection | LDAP connections should be authenticated | high | sonar-python | S4433 | new | python |
| security/deterministic/password-stored-plaintext | Password stored in plaintext or with fast hash | Passwords stored without proper hashing (e.g., MD5/SHA1 instead of bcrypt/argon2) | high | sonar-python | S5344 | new | python |
| security/deterministic/unpredictable-salt-missing | Password hashing without unpredictable salt | Password hashing function called without random salt | high | sonar-python | S2053 | new | python |
| security/deterministic/flask-secret-key-disclosed | Flask secret key disclosed | Flask secret key hardcoded in source code | critical | sonar-python | S6779 | new | python |
| security/deterministic/jwt-secret-key-disclosed | JWT secret key disclosed | JWT secret key hardcoded in source code | critical | sonar-python | S6781 | new | python |
| security/deterministic/bind-all-interfaces | Server binding to all interfaces | Server binding to 0.0.0.0 exposes service on all network interfaces | medium | ruff, sonar-python | B104 (HardcodedBindAllInterfaces), S8392 | new | python |
| security/deterministic/non-standard-crypto | Non-standard cryptographic algorithm | Using custom or non-standard cryptographic algorithms instead of established ones | high | sonar-python | S2257 | new | python |
| security/deterministic/django-raw-sql | Django raw SQL usage | Using .extra() or RawSQL in Django queries — SQL injection risk | high | ruff | S610 (DjangoExtra), S611 (DjangoRawSql) | new | python |
| security/deterministic/unsafe-markup | Unsafe HTML markup | Using Markup() or mark_safe() on untrusted content — XSS risk | high | ruff | S308 (SuspiciousMarkSafeUsage), S704 (UnsafeMarkupUse) | new | python |
| security/deterministic/logging-config-insecure-listen | Insecure logging configuration listener | Using logging.config.listen() allows remote code execution | high | ruff | S612 (LoggingConfigInsecureListen) | new | python |
| security/deterministic/graphql-dos-vulnerability | GraphQL denial of service vulnerability | GraphQL queries without depth/complexity limits — allows resource exhaustion | high | sonar-python | S6785 | new | python |
| security/deterministic/graphql-introspection-enabled | GraphQL introspection enabled in production | GraphQL introspection should be disabled in production — exposes full schema | medium | sonar-python | S6786 | new | python |
| security/deterministic/unsafe-torch-load | Unsafe torch.load usage | Using torch.load can execute arbitrary code from untrusted model files | high | sonar-python | S6985 | new | python |
| security/deterministic/unsafe-xml-signature | Insecure XML signature validation | XML signatures should be validated securely to prevent signature wrapping attacks | high | sonar-python | S6377 | new | python |
| security/deterministic/mixed-http-methods | Allowing both safe and unsafe HTTP methods | Django/Flask view accepting both GET and POST — safe and unsafe methods should be separated | medium | sonar-python | S3752 | new | python |
| security/deterministic/process-signaling | Uncontrolled process signaling | Sending signals to processes is security-sensitive and should be restricted | medium | sonar-python | S4828 | new | python |
| security/deterministic/long-term-aws-keys-in-code | Long-term AWS access keys in code | AWS access keys hardcoded in source code instead of using IAM roles or environment variables | critical | sonar-python | S7625 | new | python |
| security/deterministic/snmp-insecure-version | Insecure SNMP version | Using SNMPv1 or SNMPv2 which transmit data in cleartext | high | ruff | S508 (SnmpInsecureVersion) | new | python |
| security/deterministic/snmp-weak-crypto | Weak SNMP cryptography | Using weak cryptography with SNMPv3 | high | ruff | S509 (SnmpWeakCryptography) | new | python |
| security/deterministic/paramiko-call | Paramiko SSH call | Using Paramiko's exec_command for remote code execution — security-sensitive | medium | ruff | S601 (ParamikoCall) | new | python |
| security/deterministic/hardcoded-sql-expression | Hardcoded SQL expression | SQL query constructed from string concatenation — SQL injection risk | high | ruff | S608 (HardcodedSQLExpression) | new | python |
| security/deterministic/wildcard-in-os-command | Wildcard injection in OS command | Using wildcard characters in shell commands — allows injection via filenames | high | ruff | S609 (UnixCommandWildcardInjection) | new | python |
| security/deterministic/suspicious-url-open | Suspicious URL open | Using urllib.urlopen with user-controlled input — SSRF risk | high | ruff | S310 (SuspiciousURLOpenUsage) | new | python |
| security/deterministic/redos-vulnerable-regex-python | ReDoS vulnerable regular expression | Regular expression susceptible to catastrophic backtracking — denial of service risk | high | sonar-python | S5852 | new | python |
| security/deterministic/fastapi-file-upload-body | FastAPI file upload using Body | FastAPI file upload endpoints should use Form() with Pydantic validators instead of Body() | high | sonar-python | S8389 | new | python |
| security/deterministic/s3-missing-bucket-owner | S3 operation without bucket owner verification | S3 operations should verify bucket ownership using ExpectedBucketOwner parameter | high | sonar-python | S7608 | new | python |
| security/deterministic/s3-public-bucket-access | Public S3 bucket access | Allowing public ACLs or policies on S3 buckets | high | sonar-python | S6281 | new | python |
| security/deterministic/s3-insecure-http | S3 bucket insecure HTTP | Authorizing HTTP communications with S3 buckets | high | sonar-python | S6249 | new | python |
| security/deterministic/s3-unrestricted-access | Unrestricted S3 bucket access | Granting access to S3 buckets to all or authenticated users | high | sonar-python | S6265 | new | python |
| security/deterministic/aws-iam-overly-broad-policy | Overly broad IAM policy | IAM policies should limit the scope of permissions given | critical | sonar-python | S6317 | new | python |
| security/deterministic/aws-unrestricted-admin-access | Unrestricted admin IP access | Administration services access should be restricted to specific IP addresses | high | sonar-python | S6321 | new | python |
| security/deterministic/aws-public-policy | Public access policy | Policies authorizing public access to resources | critical | sonar-python | S6270 | new | python |
| security/deterministic/aws-iam-all-privileges-python | IAM policy grants all privileges | Policies granting all privileges are security-sensitive | critical | sonar-python | S6302 | new | python |
| security/deterministic/aws-iam-all-resources-python | IAM policy grants all resources | Policies granting access to all resources of an account | critical | sonar-python | S6304 | new | python |
| security/deterministic/aws-unrestricted-outbound | Unrestricted outbound communications | Allowing unrestricted outbound communications from cloud resources | medium | sonar-python | S6463 | new | python |
| security/deterministic/aws-unencrypted-ebs-python | Unencrypted EBS volume | Using unencrypted EBS volumes | high | sonar-python | S6275 | new | python |
| security/deterministic/aws-unencrypted-rds-python | Unencrypted RDS database | Using unencrypted RDS DB resources | high | sonar-python | S6303 | new | python |
| security/deterministic/aws-unencrypted-opensearch-python | Unencrypted OpenSearch domain | Using unencrypted OpenSearch domains | high | sonar-python | S6308 | new | python |
| security/deterministic/aws-unencrypted-sagemaker-python | Unencrypted SageMaker notebook | Using unencrypted SageMaker notebook instances | high | sonar-python | S6319 | new | python |
| security/deterministic/aws-unencrypted-sns-python | Unencrypted SNS topic | Using unencrypted SNS topics | high | sonar-python | S6327 | new | python |
| security/deterministic/aws-unencrypted-sqs-python | Unencrypted SQS queue | Using unencrypted SQS queues | high | sonar-python | S6330 | new | python |
| security/deterministic/aws-unencrypted-efs-python | Unencrypted EFS file system | Using unencrypted EFS file systems | high | sonar-python | S6332 | new | python |
| security/deterministic/aws-public-api-python | Public API Gateway | Creating public APIs without proper access control | high | sonar-python | S6333 | new | python |
| security/deterministic/aws-s3-no-versioning-python | S3 bucket without versioning | Disabling versioning of S3 buckets | medium | sonar-python | S6252 | new | python |
| security/deterministic/aws-public-resource-python | Public cloud resource | Allowing public network access to cloud resources | high | sonar-python | S6329 | new | python |
| security/deterministic/subprocess-without-shell | Subprocess call without shell security review | subprocess.call() or Popen() without shell=True — ensure user input is not passed directly | medium | ruff | S603 (SubprocessWithoutShellEqualsTrue) | new | python |
| security/deterministic/process-with-partial-path | Process started with partial path | Starting process without full path — PATH manipulation could run unexpected executable | medium | ruff | S607 (StartProcessWithPartialPath) | new | python |
| security/deterministic/ssl-no-version | SSL context without protocol version | Creating SSL context without specifying protocol version — may use insecure defaults | medium | ruff | S504 (SslWithNoVersion) | new | python |
| security/deterministic/vulnerable-library-import | Vulnerable library import | Importing libraries with known security vulnerabilities — httpoxy-vulnerable CGI handlers, pyghmi IPMI with known concerns | medium | ruff | S412 (SuspiciousHttpoxyImport), S415 (SuspiciousPyghmiImport) | new | python |
| security/deterministic/process-start-no-shell | Process started without shell — security review | Starting a process without shell=True — ensure the command and arguments cannot be influenced by user input | medium | ruff | S606 (StartProcessWithNoShell) | new | python |
| security/deterministic/non-octal-file-permissions | File permissions not in octal format | File permission values should use octal notation (e.g., 0o755) for clarity — decimal values are error-prone | medium | ruff | RUF064 (NonOctalPermissions) | new | python |

### Security / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| security/llm/missing-authorization-check | Missing authorization check | Endpoint verifies authentication but not authorization — any authenticated user can access any resource | critical | truecourse | - | new | all |
| security/llm/insecure-direct-object-reference | Insecure direct object reference (IDOR) | Resource accessed by sequential/guessable ID without ownership verification | critical | truecourse | - | new | all |
| security/llm/privilege-escalation-path | Privilege escalation path | User can modify their own role, permissions, or access level through an API endpoint | critical | truecourse | - | new | all |
| security/llm/missing-data-sanitization | Output not sanitized for context | Data rendered in HTML/SQL/shell without context-appropriate sanitization | high | truecourse | - | new | all |
| security/llm/sensitive-data-in-client-state | Sensitive data stored in client-side state | Secrets, tokens, or PII stored in localStorage, sessionStorage, or Redux state — accessible to XSS | high | truecourse | - | new | js/ts |
| security/llm/missing-account-lockout | Missing account lockout on auth endpoint | Login endpoint without rate limiting or lockout after failed attempts — brute force vulnerable | medium | truecourse | - | new | all |
| security/llm/excessive-data-exposure | Excessive data in API response | API returns more fields than client needs, including internal or sensitive fields | medium | truecourse | - | new | all |

### Security / Deterministic (AWS/Cloud IaC)

These rules apply to AWS CDK / CloudFormation / Terraform code written in JS/TS.

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| security/deterministic/aws-public-api | Public API Gateway | Creating public APIs without proper access control | high | sonarjs | S6333 (aws-apigateway-public-api) | new | js/ts |
| security/deterministic/aws-public-resource | Public cloud resource | Allowing public network access to cloud resources (EC2, RDS, DMS) | high | sonarjs | S6329 (aws-ec2-rds-dms-public) | new | js/ts |
| security/deterministic/aws-unencrypted-ebs | Unencrypted EBS volume | Using unencrypted EBS volumes | high | sonarjs | S6275 (aws-ec2-unencrypted-ebs-volume) | new | js/ts |
| security/deterministic/aws-unencrypted-efs | Unencrypted EFS | Using unencrypted EFS file systems | high | sonarjs | S6332 (aws-efs-unencrypted) | new | js/ts |
| security/deterministic/aws-iam-all-privileges | IAM policy grants all privileges | Policies granting all privileges are security-sensitive | critical | sonarjs | S6302 (aws-iam-all-privileges) | new | js/ts |
| security/deterministic/aws-iam-all-resources | IAM policy grants all resources | Policies granting access to all resources of an account | critical | sonarjs | S6304 (aws-iam-all-resources-accessible) | new | js/ts |
| security/deterministic/aws-iam-privilege-escalation | IAM privilege escalation | AWS IAM policies should limit the scope of permissions | high | sonarjs | S6317 (aws-iam-privilege-escalation) | new | js/ts |
| security/deterministic/aws-iam-public-access | IAM public access | Policies authorizing public access to resources | high | sonarjs | S6270 (aws-iam-public-access) | new | js/ts |
| security/deterministic/aws-unencrypted-opensearch | Unencrypted OpenSearch | Using unencrypted OpenSearch domains | high | sonarjs | S6308 (aws-opensearchservice-domain) | new | js/ts |
| security/deterministic/aws-unencrypted-rds | Unencrypted RDS database | Using unencrypted RDS DB resources | high | sonarjs | S6303 (aws-rds-unencrypted-databases) | new | js/ts |
| security/deterministic/aws-unrestricted-admin-ip | Unrestricted admin IP access | Administration services access should be restricted to specific IPs | high | sonarjs | S6321 (aws-restricted-ip-admin-access) | new | js/ts |
| security/deterministic/aws-s3-bucket-access | Overly permissive S3 bucket | Granting access to S3 buckets to all or authenticated users | high | sonarjs | S6265 (aws-s3-bucket-granted-access) | new | js/ts |
| security/deterministic/aws-s3-insecure-http | S3 bucket insecure HTTP | Authorizing HTTP communications with S3 buckets | high | sonarjs | S6249 (aws-s3-bucket-insecure-http) | new | js/ts |
| security/deterministic/aws-s3-public-access | S3 bucket public access | Allowing public ACLs or policies on an S3 bucket | high | sonarjs | S6281 (aws-s3-bucket-public-access) | new | js/ts |
| security/deterministic/aws-s3-no-versioning | S3 bucket without versioning | Disabling versioning of S3 buckets | medium | sonarjs | S6252 (aws-s3-bucket-versioning) | new | js/ts |
| security/deterministic/aws-unencrypted-sagemaker | Unencrypted SageMaker notebook | Using unencrypted SageMaker notebook instances | high | sonarjs | S6319 (aws-sagemaker-unencrypted-notebook) | new | js/ts |
| security/deterministic/aws-unencrypted-sns | Unencrypted SNS topic | Using unencrypted SNS topics | high | sonarjs | S6327 (aws-sns-unencrypted-topics) | new | js/ts |
| security/deterministic/aws-unencrypted-sqs | Unencrypted SQS queue | Using unencrypted SQS queues | high | sonarjs | S6330 (aws-sqs-unencrypted-queue) | new | js/ts |

---

## Bugs

Rules about actual runtime bugs: null deref, infinite loops, unreachable code, type errors.

### Bugs / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| bugs/deterministic/null-dereference | Null dereference | Accessing properties of null or undefined values | critical | sonarjs | S2259 (null-dereference) | new | js/ts |
| bugs/deterministic/unreachable-code | Unreachable code | Code after return, throw, continue, or break is never executed | high | eslint, sonar-python, ruff | no-unreachable, S1763, PLW0101 (UnreachableCode) | new | all |
| bugs/deterministic/unreachable-loop | Unreachable loop | Loop body allows only one iteration | medium | eslint | no-unreachable-loop | new | js/ts |
| bugs/deterministic/constant-condition | Constant condition | Constant expression in if/while/for/ternary condition | medium | eslint, sonarjs, sonar-python | no-constant-condition, S2589 (no-gratuitous-expressions), S5797 | new | all |
| bugs/deterministic/constant-binary-expression | Constant binary expression | Binary expression where the operation does not affect the value | medium | eslint | no-constant-binary-expression | new | js/ts |
| bugs/deterministic/self-comparison | Self comparison | Comparing a value to itself is always true or always false | medium | eslint, sonarjs, sonar-python, ruff | no-self-compare, S1764 (no-identical-expressions), PLR0124 (ComparisonWithItself) | new | all |
| bugs/deterministic/self-assignment | Self assignment | Assigning a variable to itself has no effect | medium | eslint, sonar-python, ruff | no-self-assign, S1656, PLW0127 (SelfAssigningVariable) | new | all |
| bugs/deterministic/assignment-in-condition | Assignment in condition | Assignment operator used where comparison was likely intended | high | eslint, sonarjs | no-cond-assign, S1121 (no-nested-assignment) | new | js/ts |
| bugs/deterministic/duplicate-case | Duplicate case label | Duplicate case values in switch statement | high | eslint, sonarjs | no-duplicate-case, S1862 (no-identical-conditions) | new | js/ts |
| bugs/deterministic/duplicate-keys | Duplicate object keys | Duplicate keys in object literal | high | eslint | no-dupe-keys | new | js/ts |
| bugs/deterministic/duplicate-args | Duplicate function arguments | Duplicate parameter names in function definition | high | eslint | no-dupe-args | new | js/ts |
| bugs/deterministic/duplicate-class-members | Duplicate class members | Duplicate method/property names in class | high | eslint, @typescript-eslint | no-dupe-class-members | new | js/ts |
| bugs/deterministic/duplicate-else-if | Duplicate else-if conditions | Same condition repeated in if-else-if chain | medium | eslint, sonarjs, sonar-python | no-dupe-else-if, S1862 (no-identical-conditions) | new | all |
| bugs/deterministic/all-branches-identical | All branches identical | All branches in conditional have exactly the same implementation | high | sonarjs, sonar-python | S3923 (no-all-duplicated-branches) | new | all |
| bugs/deterministic/duplicate-branches | Duplicate branches | Two branches in conditional have identical implementation | medium | sonarjs, sonar-python | S1871 (no-duplicated-branches) | new | all |
| bugs/deterministic/invalid-typeof | Invalid typeof comparison | Comparing typeof against an invalid string value | high | eslint | valid-typeof | new | js/ts |
| bugs/deterministic/use-isnan | NaN comparison | Comparing directly against NaN instead of using isNaN() | high | eslint, sonarjs | use-isnan, S3757 (operation-returning-nan) | new | js/ts |
| bugs/deterministic/compare-neg-zero | Compare against -0 | Comparing against negative zero has unexpected behavior | medium | eslint | no-compare-neg-zero | new | js/ts |
| bugs/deterministic/loss-of-precision | Loss of numeric precision | Literal number loses precision due to 64-bit floating point representation | medium | eslint | no-loss-of-precision | new | js/ts |
| bugs/deterministic/unsafe-negation | Unsafe negation | Negating left operand of relational operator (e.g., !key in obj) | high | eslint | no-unsafe-negation | new | js/ts |
| bugs/deterministic/unsafe-optional-chaining | Unsafe optional chaining | Optional chaining in context where undefined is not allowed | high | eslint | no-unsafe-optional-chaining | new | js/ts |
| bugs/deterministic/unsafe-finally | Unsafe finally | Control flow statements in finally blocks override try/catch flow | high | eslint | no-unsafe-finally | new | js/ts |
| bugs/deterministic/fallthrough-case | Fallthrough case | Switch case without break, return, or throw falls through to next case | medium | eslint, sonarjs | no-fallthrough, S128 (no-fallthrough) | new | js/ts |
| bugs/deterministic/for-direction | Wrong for-loop direction | For loop counter moves in wrong direction (infinite loop) | high | eslint, sonarjs | for-direction, S2251 (for-loop-increment-sign) | new | js/ts |
| bugs/deterministic/loop-counter-assignment | Loop counter assigned in body | Loop counter modified inside loop body instead of update clause | medium | sonarjs | S2310 (updated-loop-counter), S1994 (misplaced-loop-counter) | new | js/ts |
| bugs/deterministic/unmodified-loop-condition | Unmodified loop condition | Loop condition variable never modified inside the loop (possible infinite loop) | high | eslint | no-unmodified-loop-condition | new | js/ts |
| bugs/deterministic/const-reassignment | Const variable reassignment | Reassigning a const variable | critical | eslint, sonarjs | no-const-assign, S3500 (updated-const-var) | new | js/ts |
| bugs/deterministic/class-reassignment | Class variable reassignment | Reassigning a class declaration | high | eslint | no-class-assign | new | js/ts |
| bugs/deterministic/function-reassignment | Function reassignment | Reassigning a function declaration | high | eslint | no-func-assign | new | js/ts |
| bugs/deterministic/import-reassignment | Import binding reassignment | Assigning to an imported binding | high | eslint | no-import-assign | new | js/ts |
| bugs/deterministic/exception-reassignment | Exception variable reassignment | Reassigning exception variable in catch clause | medium | eslint | no-ex-assign | new | js/ts |
| bugs/deterministic/constructor-return | Constructor with return value | Constructor returning a value is confusing and often a bug | medium | eslint | no-constructor-return | new | js/ts |
| bugs/deterministic/setter-return | Setter with return value | Setters should not return a value | medium | eslint | no-setter-return | new | js/ts |
| bugs/deterministic/getter-missing-return | Getter without return | Getter function does not return a value | high | eslint | getter-return | new | js/ts |
| bugs/deterministic/missing-super-call | Missing super() call | Constructor in derived class does not call super() | high | eslint | constructor-super | new | js/ts |
| bugs/deterministic/this-before-super | this before super | Using this/super before calling super() in constructor | high | eslint | no-this-before-super | new | js/ts |
| bugs/deterministic/async-promise-executor | Async promise executor | Using async function as Promise executor | high | eslint | no-async-promise-executor | new | js/ts |
| bugs/deterministic/promise-executor-return | Promise executor return | Returning a value from Promise executor function | medium | eslint | no-promise-executor-return | new | js/ts |
| bugs/deterministic/empty-character-class | Empty regex character class | Empty character class in regular expression matches nothing | medium | eslint, sonarjs | no-empty-character-class, S2639 (no-empty-character-class) | new | js/ts |
| bugs/deterministic/invalid-regexp | Invalid regular expression | Syntactically invalid regular expression | high | eslint, sonarjs | no-invalid-regexp, S5856 (no-invalid-regexp) | new | js/ts |
| bugs/deterministic/control-chars-in-regex | Control characters in regex | Regular expression contains control characters | medium | eslint, sonarjs | no-control-regex, S6324 (no-control-regex) | new | js/ts |
| bugs/deterministic/useless-backreference | Useless backreference | Backreference in regex that will always match empty string | medium | eslint | no-useless-backreference | new | js/ts |
| bugs/deterministic/misleading-character-class | Misleading character class | Characters made with multiple code points in regex character class | medium | eslint, sonarjs | no-misleading-character-class, S5868 (no-misleading-character-class) | new | js/ts |
| bugs/deterministic/sparse-array | Sparse array | Array literal with holes (missing elements) | medium | eslint | no-sparse-arrays | new | js/ts |
| bugs/deterministic/template-curly-in-string | Template syntax in regular string | Template literal placeholder ${} in regular string (forgot backticks) | medium | eslint | no-template-curly-in-string | new | js/ts |
| bugs/deterministic/unexpected-multiline | Unexpected multiline expression | Confusing multiline expression that looks like two separate statements | medium | eslint | no-unexpected-multiline | new | js/ts |
| bugs/deterministic/await-in-loop | Sequential await in loop | Using await inside a loop causes sequential execution instead of parallel | medium | eslint | no-await-in-loop | new | js/ts |
| bugs/deterministic/race-condition-assignment | Race condition assignment | Assignment that can lead to race conditions with await/yield | medium | eslint | require-atomic-updates | new | js/ts |
| bugs/deterministic/element-overwrite | Unconditional element overwrite | Collection elements replaced unconditionally | high | sonarjs, sonar-python | S4143 (no-element-overwrite) | new | all |
| bugs/deterministic/empty-collection-access | Empty collection access | Accessing or iterating an empty collection | medium | sonarjs | S4158 (no-empty-collection) | new | js/ts |
| bugs/deterministic/void-return-value-used | Void return value used | Using the return value of a function that returns None/void | medium | sonarjs, sonar-python | S3699 (no-use-of-empty-return-value) | new | all |
| bugs/deterministic/ignored-return-value | Ignored return value | Return value from pure function discarded | medium | sonarjs, sonar-python | S2201 (no-ignored-return) | new | all |
| bugs/deterministic/useless-increment | Useless increment | Increment/decrement whose result is never used | medium | sonarjs | S2123 (no-useless-increment) | new | js/ts |
| bugs/deterministic/unthrown-error | Error/exception created but not raised | Error or exception object created but not thrown/raised | high | sonarjs, sonar-python | S3984 (no-unthrown-error) | new | all |
| bugs/deterministic/non-existent-operator | Non-existent operator | Using =+, =-, or =! which are not real operators | high | sonarjs, sonar-python | S2757 (non-existent-operator) | new | all |
| bugs/deterministic/in-operator-on-primitive | in operator on primitive | Using "in" operator with primitive types instead of objects | high | sonarjs | S3785 (in-operator-type-error) | new | js/ts |
| bugs/deterministic/non-number-arithmetic | Non-number in arithmetic | Arithmetic operator used with non-numeric operands | high | sonarjs | S3760 (non-number-in-arithmetic-expression) | new | js/ts |
| bugs/deterministic/values-not-convertible-to-number | Non-numeric comparison | Values not convertible to numbers used in numeric comparisons | high | sonarjs | S3758 (values-not-convertible-to-numbers) | new | js/ts |
| bugs/deterministic/dissimilar-type-comparison | Dissimilar type comparison | Strict equality between values of completely different types | high | sonarjs | S3403 (different-types-comparison) | new | js/ts |
| bugs/deterministic/argument-type-mismatch | Argument type mismatch | Arguments to built-in functions don't match documented types | high | sonarjs | S3782 (argument-type) | new | js/ts |
| bugs/deterministic/arguments-order-mismatch | Arguments in wrong order | Parameters passed in incorrect order based on names | medium | sonarjs | S2234 (arguments-order) | new | js/ts |
| bugs/deterministic/new-operator-misuse | new operator misuse | Using "new" with non-constructor functions | high | sonarjs, eslint | S2999 (new-operator-misuse), no-new-native-nonconstructor | new | js/ts |
| bugs/deterministic/collection-size-mischeck | Collection size mischeck | Collection size comparison that makes no sense (e.g., .length < 0 or len() < 0) | medium | sonarjs, sonar-python | S3981 (no-collection-size-mischeck) | new | all |
| bugs/deterministic/index-of-positive-check | indexOf checked against positive number | indexOf result compared to positive number instead of -1 | medium | sonarjs | S2692 (index-of-compare-to-positive-number) | new | js/ts |
| bugs/deterministic/array-delete | Array element delete | Using delete operator on arrays leaves holes | medium | sonarjs, @typescript-eslint | S2870 (no-array-delete), no-array-delete | new | js/ts |
| bugs/deterministic/misleading-array-reverse | Misleading array mutation | Array-mutating methods (reverse, sort) used misleadingly | medium | sonarjs | S4043 (no-misleading-array-reverse) | new | js/ts |
| bugs/deterministic/invariant-return | Invariant function return | Function always returns the same value regardless of logic | medium | sonarjs, sonar-python | S3516 (no-invariant-returns) | new | all |
| bugs/deterministic/inconsistent-return | Inconsistent function return | Function sometimes returns a value and sometimes does not | medium | sonarjs, sonar-python, eslint | S3801, consistent-return | new | all |
| bugs/deterministic/function-return-type-varies | Return type varies | Function returns different types from different paths | medium | sonarjs | S3800 (function-return-type) | new | js/ts |
| bugs/deterministic/array-callback-missing-return | Array callback missing return | Callbacks of array methods (map, filter, etc.) missing return statement | high | eslint, sonarjs | array-callback-return, S3796 (array-callback-without-return) | new | js/ts |
| bugs/deterministic/incorrect-string-concat | Incorrect string concatenation | Adding string and non-string without explicit conversion | medium | sonarjs | S3402 (no-incorrect-string-concat) | new | js/ts |
| bugs/deterministic/comma-in-switch-case | Comma in switch case | Using comma or logical OR in switch case instead of separate cases | high | sonarjs | S3616 (comma-or-logical-or-case) | new | js/ts |
| bugs/deterministic/literal-call | Literal used as function | Calling a literal value (number, string) as a function | high | sonarjs | S6958 (no-literal-call) | new | js/ts |
| bugs/deterministic/global-this-usage | Accidental global this | Using global "this" object outside class context | medium | sonarjs | S2990 (no-global-this) | new | js/ts |
| bugs/deterministic/prototype-builtins-call | Prototype builtins called directly | Calling Object.prototype methods directly on objects (e.g., obj.hasOwnProperty) | medium | eslint | no-prototype-builtins | new | js/ts |
| bugs/deterministic/redos-vulnerable-regex | ReDoS vulnerable regex | Regular expression susceptible to catastrophic backtracking | high | sonarjs | S5852 (slow-regex) | new | js/ts |
| bugs/deterministic/stateful-regex | Stateful regex global flag | Regex with global flag has stateful lastIndex property | medium | sonarjs | S6351 (stateful-regex) | new | js/ts |
| bugs/deterministic/regex-group-reference-mismatch | Regex group reference mismatch | Replacement string references non-existent regex group | high | sonarjs | S6328 (existing-groups) | new | js/ts |
| bugs/deterministic/bare-except | Bare except clause | Catching all exceptions including system exits (bare except: or except BaseException) | high | truecourse-existing, ruff, sonar-python | code/bare-except, E722 (BareExcept), BLE001 (BlindExcept), S1045 | existing | python |
| bugs/deterministic/mutable-default-argument | Mutable default argument | Default argument value is mutable (list, dict, set) and shared across calls | high | truecourse-existing, ruff, sonar-python | code/mutable-default-arg, B006 (MutableArgumentDefault), S5717 | existing | python |
| bugs/deterministic/init-return-value | __init__ returns a value | Constructor should not return a value — always returns None | high | ruff, sonar-python | PLE0101 (ReturnInInit), S2734 | new | python |
| bugs/deterministic/yield-in-init | yield in __init__ | Using yield in constructor makes it a generator — not a valid constructor | high | ruff | PLE0100 (YieldInInit) | new | python |
| bugs/deterministic/infinite-recursion | Infinite recursion | Function calls itself unconditionally — stack overflow at runtime | critical | sonar-python | S2190 | new | python |
| bugs/deterministic/assert-on-tuple | Assert on non-empty tuple | assert (condition, message) is always True — tuple is truthy; use assert condition, message | high | ruff, sonar-python | F631 (AssertTuple), S5905 | new | python |
| bugs/deterministic/loop-at-most-one-iteration | Loop with at most one iteration | Loop body always breaks, returns, or raises on first iteration — should be refactored | medium | sonar-python | S1751 | new | python |
| bugs/deterministic/break-continue-in-finally | Break/continue/return in finally block | Control flow in finally block overrides try/catch flow — exceptions silently lost | high | ruff, sonar-python | B012 (JumpStatementInFinally), S1143 | new | python |
| bugs/deterministic/float-equality-comparison | Float equality comparison | Floating point numbers compared with == — imprecise due to representation | medium | sonar-python, ruff | S1244, RUF069 (FloatEqualityComparison) | new | python |
| bugs/deterministic/string-format-error | String formatting error | String format operation has mismatched arguments — runtime error | high | ruff, sonar-python | F501-F525 (PercentFormat/StringDotFormat*), S2275, S3457 | new | python |
| bugs/deterministic/fstring-missing-placeholders | f-string without placeholders | f-string prefix with no {} expressions — unnecessary f prefix or forgotten interpolation | medium | ruff | F541 (FStringMissingPlaceholders) | new | python |
| bugs/deterministic/raise-not-implemented | raise NotImplemented instead of NotImplementedError | raise NotImplemented raises TypeError — should use NotImplementedError | high | ruff | F901 (RaiseNotImplemented) | new | python |
| bugs/deterministic/undefined-name | Undefined name used | Variable, function, or class referenced but never defined or imported | critical | ruff, sonar-python | F821 (UndefinedName), S3827, S5953 | new | python |
| bugs/deterministic/redefined-while-unused | Name redefined before used | Import or variable defined but redefined before ever being used | medium | ruff | F811 (RedefinedWhileUnused) | new | python |
| bugs/deterministic/duplicate-handler-exception | Duplicate exception in handler | Same exception class listed multiple times in except clause, or subclass caught alongside parent | medium | ruff, sonar-python | B014 (DuplicateHandlerException), S5713, B025 (DuplicateTryBlockException) | new | python |
| bugs/deterministic/exception-not-from-base-exception | Exception not derived from BaseException | Raised or caught value does not derive from BaseException — TypeError at runtime | critical | sonar-python | S5632, S5708 | new | python |
| bugs/deterministic/duplicate-dict-key | Duplicate dictionary key | Dictionary literal or comprehension with duplicate keys — last value silently wins | high | ruff, sonar-python | F601 (MultiValueRepeatedKeyLiteral), F602 (MultiValueRepeatedKeyVariable), S5780 | new | python |
| bugs/deterministic/duplicate-set-value | Duplicate set value | Set literal with duplicate values — duplicates silently ignored | medium | ruff, sonar-python | B033 (DuplicateValue), S5781 | new | python |
| bugs/deterministic/iter-not-returning-iterator | __iter__ not returning iterator | __iter__ method does not return an iterator object | high | sonar-python | S2876 | new | python |
| bugs/deterministic/type-comparison-instead-of-isinstance | Direct type comparison | Using type(x) == Y instead of isinstance(x, Y) — misses subclasses | medium | ruff, sonar-python | E721 (TypeComparison), S6660 | new | python |
| bugs/deterministic/is-literal-comparison | Identity comparison with literal | Using is/is not with string, int, or bytes literal — unreliable due to interning | high | ruff, sonar-python | F632 (IsLiteral), S5795 | new | python |
| bugs/deterministic/none-comparison-with-equality | None compared with equality operator | Using == None instead of is None — semantically different if __eq__ is overridden | medium | ruff | E711 (NoneComparison) | new | python |
| bugs/deterministic/modified-loop-iterator | Modifying collection while iterating | Modifying set/dict while iterating over it — RuntimeError | high | ruff | PLE4703 (ModifiedIteratingSet), B909 (LoopIteratorMutation) | new | python |
| bugs/deterministic/unexpected-special-method-signature | Wrong special method signature | Dunder method defined with wrong number of parameters | high | ruff, sonar-python | PLE0302 (UnexpectedSpecialMethodSignature), S5722 | new | python |
| bugs/deterministic/invalid-special-method-return-type | Invalid special method return type | __len__, __bool__, __str__, __hash__ etc. returning wrong type | high | ruff, sonar-python | PLE0303/PLE0304/PLE0307/PLE0308/PLE0309, S935 | new | python |
| bugs/deterministic/logging-args-mismatch | Logging format string args mismatch | Logging call with wrong number of arguments for format string | high | ruff | PLE1205 (LoggingTooManyArgs), PLE1206 (LoggingTooFewArgs) | new | python |
| bugs/deterministic/await-outside-async | await outside async function | Using await keyword outside of an async function | critical | ruff | PLE1142 (AwaitOutsideAsync) | new | python |
| bugs/deterministic/duplicate-base-classes | Duplicate base classes | Class inheriting from same base class multiple times | high | ruff, sonar-python | PLE0241 (DuplicateBases), S8509 | new | python |
| bugs/deterministic/non-slot-assignment | Assignment to non-slot attribute | Assigning attribute not declared in __slots__ — AttributeError at runtime | high | ruff, sonar-python | PLE0237 (NonSlotAssignment), S8494 | new | python |
| bugs/deterministic/function-call-in-default-argument | Function call in default argument | Mutable function call (e.g., datetime.now()) as default — evaluated once at definition time | high | ruff | B008 (FunctionCallInDefaultArgument) | new | python |
| bugs/deterministic/loop-variable-overrides-iterator | Loop variable overrides iterator | Loop variable has same name as iterable — iterator overwritten | high | ruff | B020 (LoopVariableOverridesIterator) | new | python |
| bugs/deterministic/raise-without-from-in-except | Raise without __cause__ in except | Raising new exception in except block without from clause — original traceback lost | medium | ruff, sonar-python | B904 (RaiseWithoutFromInsideExcept), TRY200 (ReraiseNoCause), S5707 | new | python |
| bugs/deterministic/exception-group-misuse | ExceptionGroup caught with except* | ExceptionGroup/BaseExceptionGroup should not be caught with except* — infinite recursion | high | sonar-python | S6468 | new | python |
| bugs/deterministic/zip-without-strict | zip() without strict parameter | zip() silently truncates to shortest — use strict=True to detect length mismatch | medium | ruff | B905 (ZipWithoutExplicitStrict) | new | python |
| bugs/deterministic/asyncio-dangling-task | Asyncio dangling task | asyncio.create_task() result not saved — task may be garbage collected before completion | high | ruff, sonar-python | RUF006 (AsyncioDanglingTask), S7502 | new | python |
| bugs/deterministic/mutable-dataclass-default | Mutable dataclass default | Dataclass field using mutable default value — shared across instances | high | ruff | RUF008 (MutableDataclassDefault), RUF009 (FunctionCallInDataclassDefaultArgument) | new | python |
| bugs/deterministic/mutable-class-default | Mutable class variable default | Class variable with mutable default (list, dict) — shared across all instances | high | ruff | RUF012 (MutableClassDefault) | new | python |
| bugs/deterministic/invalid-index-type | Invalid index type | Using non-integer type to index sequence — TypeError at runtime | high | ruff, sonar-python | RUF016 (InvalidIndexType), S6663 | new | python |
| bugs/deterministic/duplicate-function-arguments | Duplicate function arguments | Function called with same keyword argument multiple times | high | ruff, sonar-python | PLE1132 (RepeatedKeywordArgument), S5549 | new | python |
| bugs/deterministic/non-callable-called | Calling non-callable value | Calling an object that is not callable — TypeError at runtime | critical | sonar-python | S5756 | new | python |
| bugs/deterministic/incompatible-operator-types | Operator used on incompatible types | Binary operator applied to incompatible types — TypeError at runtime | high | sonar-python | S5607 | new | python |
| bugs/deterministic/non-iterable-unpacking | Unpacking non-iterable | Using *, for-in, or yield from on non-iterable object | high | sonar-python | S3862 | new | python |
| bugs/deterministic/not-implemented-in-bool-context | NotImplemented used in boolean context | NotImplemented is truthy — using in if/assert is always True. Return NotImplementedError instead | high | sonar-python | S7931 | new | python |
| bugs/deterministic/method-override-contract-change | Method override changes contract | Overriding method changes parameter types, defaults, or return type — Liskov violation | medium | sonar-python | S2638 | new | python |
| bugs/deterministic/blocking-call-in-async | Blocking call in async function | Synchronous I/O (open, requests, subprocess, time.sleep) inside async function — blocks event loop | high | ruff, sonar-python | ASYNC210/220/230/240/250/251 (Blocking*InAsyncFunction), S7487/S7488/S7489/S7493/S7499/S7501 | new | python |
| bugs/deterministic/cancel-scope-no-checkpoint | Cancel scope without checkpoint | Async cancel scope or timeout block without await — cancellation never checked | high | ruff, sonar-python | ASYNC100 (CancelScopeNoCheckpoint), S7490 | new | python |
| bugs/deterministic/cancellation-exception-not-reraised | Cancellation exception swallowed | Catching CancelledError/Cancelled without re-raising — prevents task cancellation | high | sonar-python | S7497 | new | python |
| bugs/deterministic/control-flow-in-task-group | Control flow in TaskGroup block | break/continue/return inside TaskGroup/Nursery block — may cancel child tasks unexpectedly | high | sonar-python | S7514 | new | python |
| bugs/deterministic/assert-raises-too-broad | pytest.raises with broad exception | Using pytest.raises(Exception) — too broad, won't catch if wrong exception type is raised | medium | ruff | PT011 (PytestRaisesTooBroad), B017 (AssertRaisesException) | new | python |
| bugs/deterministic/hashable-set-dict-member | Unhashable type in set or dict key | Using mutable type as set member or dict key — TypeError at runtime | high | sonar-python | S6662 | new | python |
| bugs/deterministic/property-without-return | Property method without return | Property getter that doesn't return a value — returns None unexpectedly | high | sonar-python, ruff | S8504, RUF066 (PropertyWithoutReturn) | new | python |
| bugs/deterministic/bad-open-mode | Invalid file open mode | open() called with invalid mode string — ValueError at runtime | high | ruff, sonar-python | PLW1501 (BadOpenMode), S5828 | new | python |
| bugs/deterministic/undefined-export | Undefined name in __all__ | Name listed in __all__ that is not defined in the module | high | ruff, sonar-python | F822 (UndefinedExport), S5807 | new | python |
| bugs/deterministic/raise-literal | Raising a literal value | raise "error" raises TypeError in Python 3 — must raise exception instance | high | ruff | B016 (RaiseLiteral) | new | python |
| bugs/deterministic/unreliable-callable-check | Unreliable callable check | Using hasattr(x, '__call__') instead of callable() — misses many cases | medium | ruff | B004 (UnreliableCallableCheck) | new | python |
| bugs/deterministic/strip-with-multi-chars | strip() with multi-character string | str.strip('abc') strips individual characters, not the substring 'abc' — common misunderstanding | medium | ruff, sonar-python | B005 (StripWithMultiCharacters), PLE1310 (BadStrStripCall) | new | python |
| bugs/deterministic/assert-false | assert False instead of raise | Using assert False instead of raising an exception — removed with -O flag | medium | ruff | B011 (AssertFalse) | new | python |
| bugs/deterministic/redundant-tuple-in-exception | Redundant tuple in except handler | except (ValueError,): with trailing comma creates unnecessary tuple | low | ruff | B013 (RedundantTupleInExceptionHandler) | new | python |
| bugs/deterministic/except-with-empty-tuple | Except with empty tuple | except (): catches nothing — useless handler | high | ruff | B029 (ExceptWithEmptyTuple) | new | python |
| bugs/deterministic/except-non-exception-class | Except with non-exception class | except clause catching a non-exception class — TypeError at runtime | high | ruff | B030 (ExceptWithNonExceptionClasses) | new | python |
| bugs/deterministic/reuse-groupby-generator | Reuse of groupby generator | itertools.groupby generator reused — second pass yields nothing | high | ruff | B031 (ReuseOfGroupbyGenerator) | new | python |
| bugs/deterministic/unintentional-type-annotation | Unintentional type annotation | x: int appearing as annotation when assignment x: int = ... was intended | medium | ruff | B032 (UnintentionalTypeAnnotation) | new | python |
| bugs/deterministic/re-sub-positional-args | re.sub positional arguments confusion | Using re.sub with positional count/flags arguments — easy to confuse with each other | medium | ruff | B034 (ReSubPositionalArgs) | new | python |
| bugs/deterministic/static-key-dict-comprehension | Static key in dict comprehension | Dictionary comprehension with constant key — overwrites same key each iteration | high | ruff, sonar-python | B035 (StaticKeyDictComprehension), S7506 | new | python |
| bugs/deterministic/mutable-contextvar-default | Mutable contextvar default | ContextVar with mutable default value — shared across async contexts | high | ruff | B039 (MutableContextvarDefault) | new | python |
| bugs/deterministic/fstring-docstring | f-string used as docstring | f-string cannot be a docstring — docstrings must be plain string literals | medium | ruff | B021 (FStringDocstring) | new | python |
| bugs/deterministic/useless-contextlib-suppress | Useless contextlib.suppress | contextlib.suppress with no exceptions — does nothing | low | ruff | B022 (UselessContextlibSuppress) | new | python |
| bugs/deterministic/star-arg-after-keyword | Star-arg unpacking after keyword arg | *args unpacking after keyword arguments — unexpected behavior | high | ruff | B026 (StarArgUnpackingAfterKeywordArg) | new | python |
| bugs/deterministic/nan-comparison | NaN comparison with == | Comparing against NaN using == is always False — use math.isnan() or numpy.isnan() | high | ruff, sonar-python | PLW0177 (NanComparison), S6725 | new | python |
| bugs/deterministic/assignment-to-os-environ | Direct assignment to os.environ | Assigning to os.environ replaces the environment dict — use os.environ.update() or setdefault() | medium | ruff | B003 (AssignmentToOsEnviron) | new | python |
| bugs/deterministic/assert-on-string-literal | Assert on string literal | assert "message" is always True — string literal is truthy | high | ruff | PLW0129 (AssertOnStringLiteral) | new | python |
| bugs/deterministic/binary-op-exception | Binary operation on exception | Using binary operators with exceptions in except clause — catches wrong exceptions | high | ruff, sonar-python | PLW0711 (BinaryOpException), S5714 | new | python |
| bugs/deterministic/super-without-brackets | super without parentheses | Using super instead of super() — references the function, not the proxy | high | ruff | PLW0245 (SuperWithoutBrackets) | new | python |
| bugs/deterministic/import-self | Module imports itself | Module importing itself — causes import errors or infinite recursion | high | ruff | PLW0406 (ImportSelf) | new | python |
| bugs/deterministic/invalid-envvar-value | Invalid os.getenv argument type | os.getenv() called with non-string argument — TypeError at runtime | high | ruff | PLE1507 (InvalidEnvvarValue) | new | python |
| bugs/deterministic/singledispatch-method-mismatch | singledispatch and singledispatchmethod mismatch | Using @singledispatch on a method or @singledispatchmethod on a function — wrong decorator | high | ruff | PLE1519 (SingledispatchMethod), PLE1520 (SingledispatchmethodFunction) | new | python |
| bugs/deterministic/yield-from-in-async | yield from in async function | Using yield from inside async function — SyntaxError, use async for instead | critical | ruff | PLE1700 (YieldFromInAsyncFunction) | new | python |
| bugs/deterministic/bidirectional-unicode | Bidirectional unicode control character | Source code contains bidirectional unicode control characters — can alter execution flow appearance | critical | ruff | PLE2502 (BidirectionalUnicode) | new | python |
| bugs/deterministic/invalid-all-object | Non-string in __all__ | Non-string object in __all__ — TypeError when importing with * | high | ruff, sonar-python | PLE0604 (InvalidAllObject), PLE0605 (InvalidAllFormat), S2823 | new | python |
| bugs/deterministic/potential-index-error | Potential IndexError | Accessing index that is likely out of range based on static analysis | high | ruff | PLE0643 (PotentialIndexError) | new | python |
| bugs/deterministic/dict-iter-missing-items | Dict iteration missing .items() | Iterating over dict and accessing both key and value without .items() — inefficient and error-prone | medium | ruff | PLE1141 (DictIterMissingItems) | new | python |
| bugs/deterministic/bad-string-format-character | Bad string format character | Invalid format character in % format string | high | ruff | PLE1300 (BadStringFormatCharacter), PLE1307 (BadStringFormatType) | new | python |
| bugs/deterministic/nonlocal-and-global | nonlocal and global for same variable | Variable declared as both nonlocal and global — SyntaxError | critical | ruff | PLE0115 (NonlocalAndGlobal) | new | python |
| bugs/deterministic/nonlocal-without-binding | nonlocal without enclosing binding | nonlocal declaration for variable not in any enclosing scope | high | ruff | PLE0117 (NonlocalWithoutBinding) | new | python |
| bugs/deterministic/load-before-global-declaration | Variable used before global declaration | Using variable before its global declaration in same scope | high | ruff | PLE0118 (LoadBeforeGlobalDeclaration) | new | python |
| bugs/deterministic/unnecessary-equality-check | Unnecessary equality check | Equality check that is always True or False due to incompatible types | high | sonar-python | S2159 | new | python |
| bugs/deterministic/comparison-to-none-constant | Comparison to None is always constant | Comparison to None that always produces the same result | medium | sonar-python | S5727 | new | python |
| bugs/deterministic/identity-with-dissimilar-types | Identity check with dissimilar types | Using is/is not with objects that can never be the same instance | high | sonar-python | S3403 | new | python |
| bugs/deterministic/new-object-identity-check | Identity check on new object | Creating a new object only to check identity — always False | high | sonar-python | S5796 | new | python |
| bugs/deterministic/not-in-operator-incompatible | in operator on non-container type | Using in/not in on object that doesn't support membership testing | high | sonar-python | S5642 | new | python |
| bugs/deterministic/item-operation-unsupported | Item operation on unsupported type | Using subscript/item operations on objects that don't support them | high | sonar-python | S5644 | new | python |
| bugs/deterministic/argument-type-mismatch-python | Argument type mismatch | Arguments passed to functions don't match expected types | high | sonar-python | S5655 | new | python |
| bugs/deterministic/regex-invalid-python | Invalid regular expression | Syntactically invalid Python regular expression | high | sonar-python | S5856 | new | python |
| bugs/deterministic/regex-alternatives-redundant | Redundant regex alternatives | Alternatives in regular expression that make other alternatives redundant | medium | sonar-python | S5855 | new | python |
| bugs/deterministic/regex-backreference-invalid | Invalid regex backreference | Backreference refers to a group that hasn't been matched yet | high | sonar-python | S6001 | new | python |
| bugs/deterministic/regex-lookahead-contradictory | Contradictory regex lookahead | Lookahead assertions that contradict each other — never matches | high | sonar-python | S6002 | new | python |
| bugs/deterministic/regex-boundary-unmatchable | Unmatchable regex boundary | Regex boundaries used in a way that can never be matched | high | sonar-python | S5996 | new | python |
| bugs/deterministic/regex-possessive-always-fails | Pattern after possessive quantifier always fails | Regex pattern following a possessive quantifier that can never match | high | sonar-python | S5994 | new | python |
| bugs/deterministic/regex-empty-alternative-python | Empty regex alternative | Regular expression contains empty alternative | medium | sonar-python | S6323 | new | python |
| bugs/deterministic/regex-group-reference-mismatch-python | Regex group replacement mismatch | Replacement string references non-existent regex group | high | sonar-python | S6328 | new | python |
| bugs/deterministic/template-string-not-processed | Template string not processed | Python 3.14 template string used without processing — produces raw Template object | high | sonar-python | S7942 | new | python |
| bugs/deterministic/template-str-concatenation | Template and str concatenated directly | Concatenating Template with str produces wrong result — process template first | high | sonar-python | S7943 | new | python |
| bugs/deterministic/inconsistent-tuple-return-length | Inconsistent tuple return length | Function returns tuples of different lengths from different paths — unpacking errors | medium | sonar-python | S8495 | new | python |
| bugs/deterministic/instance-method-missing-self | Instance method missing self parameter | Instance or class method with no positional parameters — TypeError when called | critical | sonar-python | S5719 | new | python |
| bugs/deterministic/property-param-count-wrong | Property method wrong parameter count | Property getter/setter/deleter with wrong number of parameters | high | sonar-python | S5724 | new | python |
| bugs/deterministic/exit-re-raise-in-except | __exit__ should not re-raise exception | __exit__ re-raising the provided exception instead of returning False | medium | sonar-python | S5706 | new | python |
| bugs/deterministic/parameter-initial-value-ignored | Function parameter initial value ignored | Parameter reassigned at start of function — default value never used | medium | sonar-python | S1226 | new | python |
| bugs/deterministic/mutable-fromkeys-value | Mutable value in dict.fromkeys | dict.fromkeys() with mutable default — all keys share same mutable object | high | ruff | RUF024 (MutableFromkeysValue) | new | python |
| bugs/deterministic/defaultdict-default-factory-kwarg | defaultdict with default_factory keyword | defaultdict(default_factory=list) — first positional arg is the factory, keyword is ignored | high | ruff, sonar-python | RUF026 (DefaultFactoryKwarg), S7507 | new | python |
| bugs/deterministic/assignment-in-assert | Assignment in assert statement | Using assignment expression in assert — assert may be removed with -O flag | medium | ruff | RUF018 (AssignmentInAssert) | new | python |
| bugs/deterministic/assert-with-print-message | Assert with print as message | assert condition, print("msg") — print executes regardless, not used as message | medium | ruff | RUF030 (AssertWithPrintMessage) | new | python |
| bugs/deterministic/decimal-from-float | Decimal constructed from float literal | Decimal(0.1) creates Decimal('0.1000000000000000055511151231257827021181583404541015625') — use Decimal("0.1") | high | ruff | RUF032 (DecimalFromFloatLiteral) | new | python |
| bugs/deterministic/invalid-assert-message | Invalid assert message literal | Assert message is not a string — may produce confusing error output | medium | ruff | RUF040 (InvalidAssertMessageLiteralArgument) | new | python |
| bugs/deterministic/never-union | Never type in union | Union type contains Never — simplifies to just the other type | low | ruff | RUF020 (NeverUnion) | new | python |
| bugs/deterministic/implicit-optional | Implicit Optional type | Parameter with None default but type hint doesn't include Optional/None | medium | ruff | RUF013 (ImplicitOptional) | new | python |
| bugs/deterministic/in-empty-collection | Membership test on empty collection | Using in with an empty list/set/dict — always False | medium | ruff | RUF060 (InEmptyCollection) | new | python |
| bugs/deterministic/missing-fstring-syntax | String looks like f-string but missing f prefix | String contains {variable_name} pattern but is not an f-string — likely forgot f prefix | medium | ruff | RUF027 (MissingFStringSyntax) | new | python |
| bugs/deterministic/unraw-re-pattern | Unraw regex pattern | Regex pattern without raw string prefix — backslashes may be interpreted as escape sequences | medium | ruff | RUF039 (UnrawRePattern) | new | python |
| bugs/deterministic/lambda-assignment | Lambda assigned to variable | Lambda assigned to variable instead of using def — lambda has no name in tracebacks | low | ruff, sonar-python | E731 (LambdaAssignment), S6661 | new | python |
| bugs/deterministic/django-json-response-safe-flag | Django JsonResponse safe flag incorrect | Using safe=True (default) with non-dict object in JsonResponse — TypeError | high | sonar-python | S6560 | new | python |
| bugs/deterministic/flask-query-params-in-post | Query parameters in Flask POST | Using request.args in Flask POST handler — should use request.form or request.get_json() | high | sonar-python | S8370 | new | python |
| bugs/deterministic/flask-header-access-keyerror | Unsafe Flask header access | Accessing Flask request headers with [] instead of .get() — KeyError if missing | high | sonar-python | S8371 | new | python |
| bugs/deterministic/flask-class-view-decorator-wrong | Flask class-based view decorators applied wrong | Flask class-based view decorators should be applied using the decorators attribute | high | sonar-python | S8374 | new | python |
| bugs/deterministic/flask-preprocess-return-unhandled | Flask preprocess_request return not handled | Flask preprocess_request() return values should be handled — can short-circuit request | high | sonar-python | S8375 | new | python |
| bugs/deterministic/flask-send-file-missing-mimetype | Flask send_file without mimetype | send_file() with file-like object requires mimetype or download_name | high | sonar-python | S8385 | new | python |
| bugs/deterministic/fastapi-204-with-body | FastAPI 204 response with body | Endpoint returning 204 status should have an empty response body | high | sonar-python | S8400 | new | python |
| bugs/deterministic/fastapi-child-router-order | FastAPI child router included after parent | Child routers should be included before parent router registration | high | sonar-python | S8401 | new | python |
| bugs/deterministic/fastapi-unused-path-parameter | FastAPI path parameter not in function | FastAPI path parameter not included in route function signature | high | ruff, sonar-python | FAST003 (FastApiUnusedPathParameter), S8411 | new | python |
| bugs/deterministic/fastapi-redundant-response-model | FastAPI redundant response_model | FastAPI route with redundant response_model matching return type annotation | low | ruff, sonar-python | FAST001 (FastApiRedundantResponseModel), S8409 | new | python |
| bugs/deterministic/lambda-handler-returns-non-serializable | AWS Lambda handler non-serializable return | AWS Lambda handlers should return only JSON serializable values | high | sonar-python | S7613 | new | python |
| bugs/deterministic/lambda-network-call-no-timeout | Lambda network call without timeout | Network calls in AWS Lambda functions without explicit timeout parameters | high | sonar-python | S7618 | new | python |
| bugs/deterministic/lambda-tmp-not-cleaned | Lambda handler not cleaning /tmp | AWS Lambda handlers should clean up temporary files in /tmp directory | medium | sonar-python | S7620 | new | python |
| bugs/deterministic/scikit-pipeline-cache-direct-access | Pipeline transformer accessed directly | Transformers should not be accessed directly when Scikit-Learn Pipeline uses caching | high | sonar-python | S6971 | new | python |
| bugs/deterministic/einops-pattern-invalid | Invalid einops pattern | Einops rearrange/reduce pattern string is syntactically invalid | high | sonar-python | S6984 | new | python |
| bugs/deterministic/pytorch-nn-module-missing-super | PyTorch nn.Module missing super().__init__ | Subclass of torch.nn.Module should call super().__init__() | high | sonar-python | S6978 | new | python |
| bugs/deterministic/empty-pattern | Empty destructuring pattern | Destructuring pattern that binds nothing | medium | eslint | no-empty-pattern | new | js/ts |
| bugs/deterministic/no-obj-calls | Global object called as function | Calling Math, JSON, Reflect, or Atomics as functions | high | eslint | no-obj-calls | new | js/ts |
| bugs/deterministic/async-constructor | Async constructor | Constructor contains async operations that won't be awaited | high | sonarjs | S7059 (no-async-constructor) | new | js/ts |
| bugs/deterministic/global-reassignment | Global reassignment | Reassigning native objects or read-only globals | high | eslint | no-global-assign | new | js/ts |
| bugs/deterministic/variable-redeclaration | Variable redeclaration | Redeclaring the same variable in the same scope | high | eslint | no-redeclare | new | js/ts |
| bugs/deterministic/restricted-name-shadowing | Restricted name shadowing | Shadowing built-in names like undefined, NaN, Infinity | high | eslint | no-shadow-restricted-names | new | js/ts |
| bugs/deterministic/case-declaration-leak | Case declaration leak | Lexical declarations in case clauses without blocks | high | eslint | no-case-declarations | new | js/ts |
| bugs/deterministic/delete-variable | Delete variable | Using delete operator on variables | medium | eslint | no-delete-var | new | js/ts |
| bugs/deterministic/octal-literal | Octal literal | Confusing octal literal syntax | medium | eslint | no-octal | new | js/ts |
| bugs/deterministic/octal-escape | Octal escape | Deprecated octal escape sequences in strings | medium | eslint | no-octal-escape | new | js/ts |
| bugs/deterministic/nonstandard-decimal-escape | Nonstandard decimal escape | Invalid \8 and \9 escape sequences | medium | eslint | no-nonoctal-decimal-escape | new | js/ts |
| bugs/deterministic/invisible-whitespace | Invisible whitespace | Irregular whitespace characters in source code | medium | eslint | no-irregular-whitespace | new | js/ts |
| bugs/deterministic/lost-error-context | Lost error context | Reassigning or discarding caught error variable | medium | eslint | preserve-caught-error | new | js/ts |
| bugs/deterministic/label-variable-collision | Label variable collision | Labels sharing names with variables | medium | eslint | no-label-var | new | js/ts |
| bugs/deterministic/unassigned-variable | Unassigned variable | Variable declared and read but never assigned — always undefined | high | eslint | no-unassigned-vars | new | js/ts |
| bugs/deterministic/missing-radix | Missing radix argument | parseInt() without radix argument can produce unexpected results | medium | eslint | radix | new | js/ts |
| bugs/deterministic/extra-arguments-ignored | Extra arguments ignored | Function called with more arguments than parameters — extras silently ignored | medium | sonarjs | S930 (no-extra-arguments) | new | js/ts |
| bugs/deterministic/confusing-increment-decrement | Confusing increment decrement | Increment/decrement mixed with other operators — evaluation order confusion | medium | sonarjs | S881 (no-nested-incdec) | new | js/ts |
| bugs/deterministic/future-reserved-word | Future reserved word | Using future reserved words as identifiers — will break when language evolves | medium | eslint, sonarjs | no-reserved-keys, S1527 | new | js/ts |
| bugs/deterministic/label-on-non-loop | Label on non-loop | Labels applied to statements other than loops/switch — always a mistake | medium | sonarjs | S1439 (label-position) | new | js/ts |
| bugs/deterministic/usestate-object-mutation | Direct mutation of React state object | Mutating state object directly instead of creating new reference — React won't detect the change | high | truecourse | - | new | js/ts |
| bugs/deterministic/useeffect-missing-deps | useEffect with missing dependency | useEffect references variable not in dependency array — stale closure bug | high | truecourse | - | new | js/ts |
| bugs/deterministic/useeffect-object-dep | Object/array in useEffect dependency array | Object or array literal in useEffect deps — new reference every render, infinite loop | high | truecourse | - | new | js/ts |
| bugs/deterministic/conditional-hook | Hook called conditionally | useState/useEffect/useMemo called inside if/for/early-return — violates rules of hooks | critical | truecourse | - | new | js/ts |
| bugs/deterministic/async-void-function | Async function returning void | Async function that is not awaited and has no error handling — fire-and-forget loses errors | high | truecourse | - | new | js/ts |
| bugs/deterministic/shared-mutable-module-state | Shared mutable state in module scope | Module-level let/var mutated from multiple callers or request handlers — shared mutable state causes race conditions | high | truecourse | - | new | all |
| bugs/deterministic/missing-await | Missing await on async call | Async function called without await in async context — likely a bug, not intentional fire-and-forget | high | truecourse | - | new | js/ts |
| bugs/deterministic/generic-error-message | Generic error message | Error response says "Something went wrong" without error code or actionable detail — unhelpful for debugging | low | truecourse | - | new | all |
| bugs/deterministic/error-type-any | Error caught as any/unknown without narrowing | Catch block types error as any and accesses properties without type narrowing — runtime error risk | medium | truecourse | - | new | js/ts |
| bugs/deterministic/missing-error-boundary | React component tree without error boundary | React component tree (especially with async data) without ErrorBoundary — white screen on error | medium | truecourse | - | new | js/ts |
| bugs/deterministic/error-swallowed-in-callback | Error parameter ignored in callback | Callback receives error parameter (err, error) but never checks or uses it | high | truecourse | - | new | js/ts |
| bugs/deterministic/nested-try-catch | Deeply nested try-catch blocks | Multiple levels of try-catch nesting — error handling logic is convoluted and likely wrong | low | truecourse | - | new | all |
| bugs/deterministic/async-function-with-timeout | Async function accepting timeout | Async functions should use deadline/cancel scope patterns instead of timeout parameters | medium | ruff, sonar-python | ASYNC109 (AsyncFunctionWithTimeout), S7483 | new | python |
| bugs/deterministic/async-busy-wait | Async busy wait loop | Using sleep in a while loop instead of events or conditions in async code | medium | ruff, sonar-python | ASYNC110 (AsyncBusyWait), S7484 | new | python |
| bugs/deterministic/warnings-no-stacklevel | warnings.warn without stacklevel | warnings.warn() called without stacklevel parameter — warning points to wrong location | medium | ruff | B028 (NoExplicitStacklevel) | new | python |
| bugs/deterministic/unused-loop-variable | Unused loop control variable | Loop variable never used in body — use _ to indicate intentional discard | low | ruff | B007 (UnusedLoopControlVariable) | new | python |
| bugs/deterministic/return-in-generator | Return value in generator | Generator function using return with a value — confusing, use yield instead | medium | ruff, sonar-python | B901 (ReturnInGenerator), S2712 | new | python |
| bugs/deterministic/batched-without-strict | itertools.batched without strict | itertools.batched() without strict=True — silently ignores incomplete last batch | medium | ruff | B911 (BatchedWithoutExplicitStrict) | new | python |
| bugs/deterministic/datetime-without-timezone | Datetime created without timezone | Creating datetime objects without timezone info — ambiguous, causes bugs when comparing or converting | medium | ruff, sonar-python | DTZ001-DTZ012 (CallDatetime*/CallDate*), S6903, S6887 | new | python |
| bugs/deterministic/datetime-min-max | datetime.min/max usage | Using datetime.min or datetime.max as sentinel values — can cause overflow and comparison issues | medium | ruff, sonar-python | DTZ901 (DatetimeMinMax), S6882 | new | python |
| bugs/deterministic/runtime-import-in-type-checking | Runtime import in TYPE_CHECKING block | Import needed at runtime placed inside TYPE_CHECKING block — NameError at runtime | high | ruff | TC004 (RuntimeImportInTypeCheckingBlock) | new | python |
| bugs/deterministic/logging-deprecated-warn | Deprecated logging.warn usage | Using logging.warn() instead of logging.warning() — warn is deprecated | low | ruff | G010 (LoggingWarn), PGH002 (DeprecatedLogWarn), LOG009 (UndocumentedWarn) | new | python |
| bugs/deterministic/logging-invalid-getlogger | Invalid getLogger argument | logging.getLogger() called with invalid argument — should use __name__ | medium | ruff | LOG002 (InvalidGetLoggerArgument) | new | python |
| bugs/deterministic/logging-exception-outside-handler | logging.exception outside except handler | Calling logging.exception() or using exc_info=True outside an except block — no exception to log | high | ruff | LOG004 (LogExceptionOutsideExceptHandler), LOG014 (ExcInfoOutsideExceptHandler) | new | python |
| bugs/deterministic/invalid-mock-access | Invalid mock access | Accessing attribute on mock that looks like a typo (assert_called_once vs assert_called_once_with) | high | ruff | PGH005 (InvalidMockAccess) | new | python |
| bugs/deterministic/useless-exception-statement | Exception created but not raised or stored | Exception object created as a statement — likely missing raise keyword | high | ruff | PLW0133 (UselessExceptionStatement) | new | python |
| bugs/deterministic/self-or-cls-assignment | Assignment to self or cls | Reassigning self or cls parameter — breaks method behavior | high | ruff | PLW0642 (SelfOrClsAssignment) | new | python |
| bugs/deterministic/global-at-module-level | Global statement at module level | Using global at module level — has no effect | medium | ruff | PLW0604 (GlobalAtModuleLevel) | new | python |
| bugs/deterministic/redefined-slots-in-subclass | Redefined __slots__ in subclass | __slots__ in subclass redefines parent slots — causes duplicated slot behavior | medium | ruff | PLW0244 (RedefinedSlotsInSubclass) | new | python |
| bugs/deterministic/bad-staticmethod-argument | Static method with self parameter | Static method defined with self/cls as first parameter — likely missing @classmethod | medium | ruff | PLW0211 (BadStaticmethodArgument) | new | python |
| bugs/deterministic/subprocess-popen-preexec-fn | subprocess.Popen with preexec_fn | Using preexec_fn with subprocess — not safe with threads, use start_new_session instead | medium | ruff | PLW1509 (SubprocessPopenPreexecFn) | new | python |
| bugs/deterministic/named-expr-without-context | Walrus operator without context | Using walrus operator (:=) where the result is not used — confusing side effect | medium | ruff, sonar-python | PLW0131 (NamedExprWithoutContext), S5685 | new | python |
| bugs/deterministic/redefined-argument-from-local | Loop variable redefines parameter | for-loop or with variable redefines function parameter — original value lost | medium | ruff, sonar-python | PLR1704 (RedefinedArgumentFromLocal), S8510 | new | python |
| bugs/deterministic/invalid-character-in-source | Invalid control character in source | Source file contains invisible control characters (backspace, sub, esc, nul, zero-width space) that can change behavior | high | ruff | PLE2510-PLE2515 (InvalidCharacter*) | new | python |
| bugs/deterministic/duplicate-entry-dunder-all | Duplicate entry in __all__ | Same name appears multiple times in __all__ — likely a copy-paste error | medium | ruff | RUF068 (DuplicateEntryInDunderAll) | new | python |
| bugs/deterministic/useless-finally | Useless finally block | finally block with no statements or only pass — serves no purpose | low | ruff | RUF072 (UselessFinally) | new | python |
| bugs/deterministic/post-init-default | Dataclass __post_init__ with default | Dataclass field with default used in __post_init__ — default may be unexpectedly overridden | medium | ruff | RUF033 (PostInitDefault) | new | python |
| bugs/deterministic/implicit-classvar-in-dataclass | Implicit ClassVar in dataclass | Class variable in dataclass without ClassVar annotation — treated as instance field | medium | ruff | RUF045 (ImplicitClassVarInDataclass) | new | python |
| bugs/deterministic/falsy-dict-get-fallback | Falsy dict.get fallback | dict.get(key, 0) or dict.get(key, "") where existing value could also be falsy — consider checking None | low | ruff | RUF056 (FalsyDictGetFallback) | new | python |
| bugs/deterministic/class-mixed-typevars | Class with mixed TypeVars | Class using both old-style TypeVar and new-style type parameters — inconsistent | medium | ruff, sonar-python | RUF053 (ClassWithMixedTypeVars), S6795, S8515 | new | python |
| bugs/deterministic/confusing-implicit-concat | Confusing implicit string/byte concatenation | Adjacent string or byte literals that appear to be separate expressions — likely missing operator | medium | sonar-python | S5799 | new | python |
| bugs/deterministic/assertion-incompatible-types | Assertion comparing incompatible types | Test assertion comparing values of incompatible types — always fails or always passes | high | sonar-python | S5845 | new | python |
| bugs/deterministic/assertion-after-expected-exception | Assertion at end of except block | Assertion after catching expected exception — should be in else block or after the with block | high | sonar-python | S5915 | new | python |
| bugs/deterministic/math-isclose-zero-no-abstol | math.isclose to zero without abs_tol | Using math.isclose(x, 0) without abs_tol — relative tolerance is useless near zero | high | sonar-python | S6727 | new | python |
| bugs/deterministic/numpy-weekmask-invalid | Invalid NumPy weekmask | numpy.busdaycal weekmask has invalid value — should be 7-character string of 0s and 1s | high | sonar-python | S6900 | new | python |
| bugs/deterministic/datetime-12h-format-without-ampm | Datetime 12-hour format without AM/PM | Using 12-hour time format without AM/PM marker or 24-hour format with AM/PM — produces wrong times | high | sonar-python | S6883 | new | python |
| bugs/deterministic/datetime-constructor-range | Invalid datetime constructor values | datetime constructor with out-of-range values — raises ValueError at runtime | high | sonar-python | S6882 | new | python |
| bugs/deterministic/tf-function-side-effects | Side effects in tf.function | Python side effects (print, list.append) inside tf.function — only execute during tracing, not runtime | high | sonar-python | S6928 | new | python |
| bugs/deterministic/ml-reduction-axis-missing | Missing reduction axis in ML operation | Reduction operations (sum, mean, max) without specifying axis/dim — may reduce entire tensor unexpectedly | high | sonar-python | S6929 | new | python |
| bugs/deterministic/sklearn-pipeline-invalid-params | Invalid nested pipeline parameters | Nested estimator parameters modification refers to invalid parameter names | high | sonar-python | S6972 | new | python |
| bugs/deterministic/sklearn-estimator-trailing-underscore | BaseEstimator init sets trailing underscore | Scikit-Learn BaseEstimator __init__ should not set attributes ending with _ — reserved for fitted state | high | sonar-python | S6974 | new | python |
| bugs/deterministic/fastapi-cors-middleware-order | CORSMiddleware not last in chain | CORSMiddleware should be added last in the middleware chain — otherwise CORS headers may be missing | high | sonar-python | S8414 | new | python |
| bugs/deterministic/yield-return-outside-function | Control flow statement outside valid context | yield/return outside function, break/continue outside loop — SyntaxError at runtime | critical | sonar-python, ruff | S2711, S1716, F701 (BreakOutsideLoop), F702 (ContinueOutsideLoop), F704 (YieldOutsideFunction), F706 (ReturnOutsideFunction) | new | python |
| bugs/deterministic/pytest-assert-always-false | pytest assert always false | assert False in test — use pytest.fail() instead, which provides better output | medium | ruff | PT015 (PytestAssertAlwaysFalse) | new | python |
| bugs/deterministic/unary-prefix-increment-decrement | Unary prefix increment/decrement | ++x and --x in Python are no-ops (double unary plus/minus) — likely a mistake from C/Java habits | high | ruff, sonar-python | B002 (UnaryPrefixIncrementDecrement), PreIncrementDecrement | new | python |
| bugs/deterministic/single-string-slots | __slots__ as single string | __slots__ defined as a single string instead of iterable — should be a tuple or list to avoid per-character slots | high | ruff | PLC0205 (SingleStringSlots) | new | python |
| bugs/deterministic/dict-index-missing-items | Dict access without __contains__ check | __getitem__/__setitem__ accessing dict without checking __contains__ first — KeyError risk | medium | ruff | PLC0206 (DictIndexMissingItems) | new | python |
| bugs/deterministic/map-without-strict | map() without explicit strict | map() without explicit strict parameter — may silently truncate when iterables differ in length | medium | ruff | B912 (MapWithoutExplicitStrict) | new | python |
| bugs/deterministic/pandas-nunique-constant-series | pandas.nunique on constant series | pandas.nunique() on constant series always returns 1 — likely a logic error | medium | ruff | PD101 (PandasNuniqueConstantSeriesCheck) | new | python |
| bugs/deterministic/unsupported-method-call-on-all | Unsupported method call on __all__ | Calling unsupported methods on __all__ (e.g., __all__.append) — may not work at runtime | medium | ruff | PYI056 (UnsupportedMethodCallOnAll) | new | python |
| bugs/deterministic/invalid-pathlib-with-suffix | Invalid Path.with_suffix argument | Path.with_suffix() argument must start with '.' — ValueError at runtime | high | ruff | PTH210 (InvalidPathlibWithSuffix) | new | python |
| bugs/deterministic/dataclass-enum-conflict | Dataclass on Enum subclass | Using @dataclass on Enum subclass — dataclass semantics conflict with Enum behavior | high | ruff | RUF049 (DataclassEnum) | new | python |
| bugs/deterministic/access-annotations-from-class-dict | Accessing __annotations__ from class __dict__ | Accessing __annotations__ from class __dict__ — use typing.get_type_hints() instead for correct resolution | medium | ruff | RUF063 (AccessAnnotationsFromClassDict) | new | python |
| bugs/deterministic/pytest-fixture-misuse | pytest fixture/decorator misuse | Fixture with params but no request parameter, @pytest.mark.usefixtures on fixture or without parameters, pytest.raises without exception type, parameter with default shadowing fixture | high | ruff | PT010, PT019, PT025, PT026, PT028 | new | python |
| bugs/deterministic/airflow-usage-error | Airflow usage error | Airflow variable name/task_id mismatch, DAG missing schedule argument, Variable.get outside task, incompatible function signatures, dynamic DAG values | high | ruff | AIR001, AIR002, AIR003, AIR303, AIR304 | new | python |
| bugs/deterministic/invalid-print-syntax | Invalid print syntax | `print >> sys.stderr` is invalid in Python 3 — SyntaxError at runtime | high | ruff | F633 (InvalidPrintSyntax) | new | python |
| bugs/deterministic/default-except-not-last | Default except not last handler | Bare `except:` clause not as the last exception handler — SyntaxError | high | ruff | F707 (DefaultExceptNotLast) | new | python |
| bugs/deterministic/forward-annotation-syntax-error | Forward annotation syntax error | Syntax error in forward type annotation string — NameError/SyntaxError at runtime | high | ruff | F722 (ForwardAnnotationSyntaxError) | new | python |
| bugs/deterministic/unreliable-sys-version-check | Unreliable sys.version check | Using string slicing/indexing on sys.version for version comparison — breaks for Python 3.10+ where minor version is two digits | high | ruff | YTT101-YTT103, YTT201, YTT203, YTT204, YTT301-YTT303 | new | python |
| bugs/deterministic/lowercase-environment-variable | Lowercase environment variable key | `os.environ["lowercase"]` — environment variables are conventionally UPPER_CASE, lowercase suggests a typo or bug | medium | ruff | SIM112 (UncapitalizedEnvironmentVariables) | new | python |
| bugs/deterministic/fstring-in-gettext | Dynamic string in gettext call | f-string, .format(), or printf-style % used in gettext/i18n call — translation string cannot be extracted by tools | high | ruff | INT001 (FStringInGetTextFuncCall), INT002 (FormatInGetTextFuncCall), INT003 (PrintfInGetTextFuncCall) | new | python |
| bugs/deterministic/invalid-pyproject-toml | Invalid pyproject.toml | pyproject.toml file has invalid TOML syntax or schema errors — build tools will fail | high | ruff | RUF200 (InvalidPyprojectToml) | new | python |
| bugs/deterministic/type-stub-version-check-error | Type stub version/platform check error | Incorrect sys.version_info or sys.platform comparisons in .pyi stub files — wrong tuple length, bad comparison operator, unrecognized platform, or non-ascending order | high | ruff | PYI003-PYI008, PYI066 | new | python |
| bugs/deterministic/type-stub-annotation-error | Type stub annotation error | Incorrect type annotations in .pyi stubs: Set import shadowing builtin, __eq__/__ne__ params as Any instead of object, __new__/__enter__/__aenter__ not returning Self, __exit__/__aexit__ wrong param types, __all__/__slots__ unassigned, NoReturn parameter, Generic not last base class | high | ruff | PYI025, PYI032, PYI034, PYI035, PYI036, PYI050, PYI059 | new | python |
| bugs/deterministic/exit-method-wrong-signature | __exit__ method wrong signature | Context manager __exit__ must accept (self, exc_type, exc_val, exc_tb) — incorrect signature breaks exception handling | high | sonar-python | S2733 | new | python |
| bugs/deterministic/members-differ-only-by-case | Members differ only by capitalization | Two members in same class differing only by case (e.g., getValue vs getvalue) — confusing and error-prone | medium | sonar-python | S1845 | new | python |
| bugs/deterministic/classmethod-first-argument-naming | Wrong first argument name in class method | @classmethod first arg should be cls, instance method first arg should be self — incorrect naming causes subtle bugs | medium | sonar-python | S2710 | new | python |
| bugs/deterministic/ambiguous-div-regex | Ambiguous division-like regex | Regular expression starting with `=` sign — looks like /= division operator, confusing readers | low | eslint | no-div-regex | new | js/ts |
| bugs/deterministic/import-star-undefined | Undefined names from import-star | `from x import *` creates names that may be undefined — `import *` usage hides origins, loop vars shadow imports, nested star imports, names used from star import may not exist | high | ruff | F402 (ImportShadowedByLoopVar), F403 (UndefinedLocalWithImportStar), F405 (UndefinedLocalWithImportStarUsage), F406 (UndefinedLocalWithNestedImportStarUsage) | new | python |
| bugs/deterministic/future-feature-not-defined | Future feature not defined | `from __future__ import feature` where feature does not exist in Python | high | ruff | F407 (FutureFeatureNotDefined) | new | python |
| bugs/deterministic/star-assignment-error | Invalid starred assignment | Too many expressions in starred assignment or multiple starred expressions in single assignment | high | ruff | F621 (ExpressionsInStarAssignment), F622 (MultipleStarredExpressions) | new | python |
| bugs/deterministic/if-tuple-always-true | Non-empty tuple as if condition | `if (condition,):` is always True — tuple is truthy; likely parentheses/comma mistake | high | ruff | F634 (IfTuple) | new | python |
| bugs/deterministic/undefined-local-variable | Local variable referenced before assignment | Variable used before being assigned in current scope — NameError at runtime | critical | ruff | F823 (UndefinedLocal) | new | python |
| bugs/deterministic/trio-sync-call | Synchronous call in Trio async | Calling synchronous functions from Trio async context — blocks event loop | high | ruff | ASYNC105 (TrioSyncCall) | new | python |
| bugs/deterministic/return-in-try-except-finally | Return in try/except/finally | Return statement in try/except/finally creates confusing control flow — return in finally overrides returns in try/except | medium | ruff | SIM107 (ReturnInTryExceptFinally) | new | python |
| bugs/deterministic/bare-raise-in-finally | Bare raise in finally block | Bare `raise` statement in `finally` block — unpredictable behavior, may re-raise wrong exception | high | sonar-python | S5704 | new | python |
| bugs/deterministic/static-key-dict-comprehension-ruff | Static key in dict comprehension (ruff) | Dictionary comprehension with constant key — overwrites same key each iteration | high | ruff | RUF011 (RuffStaticKeyDictComprehension) | new | python |
| bugs/deterministic/pytest-raises-ambiguous-pattern | pytest.raises ambiguous match pattern | `pytest.raises` with `match` parameter that is ambiguous or could match unintended exceptions | medium | ruff | RUF043 (PytestRaisesAmbiguousPattern) | new | python |
| bugs/deterministic/used-dummy-variable | Used dummy variable | Variable named with `_` prefix (indicating unused) but actually referenced in code — naming is misleading | medium | ruff | RUF052 (UsedDummyVariable) | new | python |
| bugs/deterministic/os-path-commonprefix-bug | os.path.commonprefix character-level | `os.path.commonprefix` does character-level comparison, not path-level — use `os.path.commonpath` instead | medium | ruff | RUF071 (OsPathCommonprefix) | new | python |
| bugs/deterministic/logging-exception-no-exc-info | logging.exception without exception context | Calling `logging.exception()` outside exception handler or without exception info — no exception to log | high | ruff | LOG007 (ExceptionWithoutExcInfo) | new | python |
| bugs/deterministic/no-undef | Undeclared variable reference (JS) | Using variables not declared or mentioned in `/*global */` comments — ReferenceError at runtime | high | eslint | no-undef | new | js/ts |
| bugs/deterministic/null-comparison-without-type-check | Null comparison without type check | Comparing against `null` without using `===` or `!==` — `== null` matches both null and undefined | medium | eslint | no-eq-null | new | js/ts |
| bugs/deterministic/extra-non-null-assertion | Extra non-null assertion | Extraneous `!` non-null assertions — double `!!` assertion is redundant and likely a mistake | medium | @typescript-eslint | no-extra-non-null-assertion | new | js/ts |
| bugs/deterministic/iter-returns-iterable | __iter__ returns Iterable instead of Iterator | `__iter__` method returning `Iterable` type instead of `Iterator` — confuses type checkers and may cause runtime issues | medium | ruff | PYI045 (IterMethodReturnIterable), PYI058 (GeneratorReturnFromIterMethod) | new | python |
| bugs/deterministic/legacy-pytest-raises | Legacy form of pytest.raises | Using legacy form of `pytest.raises` without `with` statement — harder to inspect and less robust | low | ruff | RUF061 (LegacyFormPytestRaises) | new | python |

### Bugs / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| bugs/llm/race-condition-check-then-act | Check-then-act race condition | Checking a condition then acting on it without atomicity — state may change between check and act | high | truecourse | - | new | all |
| bugs/llm/concurrent-file-access | Concurrent file system access | Multiple async operations reading/writing same file without coordination — data corruption risk | medium | truecourse | - | new | all |
| bugs/llm/missing-lock-distributed | Missing distributed lock | Multiple service instances operating on shared resource without distributed locking | high | truecourse | - | new | all |
| bugs/llm/event-ordering-assumption | Assumption about event ordering | Code assumes events arrive in specific order without guarantees — breaks under load or redelivery | medium | truecourse | - | new | all |
| bugs/llm/race-condition-shared-state | Race condition on shared mutable state | Multiple async operations reading/writing same state without synchronization | high | truecourse | - | new | all |
| bugs/llm/missing-error-recovery | Missing error recovery strategy | System component fails without fallback, retry, or degraded mode — single point of failure | medium | truecourse | - | new | all |
| bugs/llm/misleading-error-message | Error message does not match actual error | Catch block returns misleading error text — confuses debugging ("user not found" when actually DB timeout) | medium | truecourse | - | new | all |
| bugs/llm/error-lost-in-transformation | Error information lost during transformation | Original error discarded when creating new error — stack trace and original cause lost | medium | truecourse | - | new | all |

### Bugs / Deterministic (TypeScript-specific)

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| bugs/deterministic/await-non-thenable | Awaiting non-thenable | Awaiting a value that is not a Promise or Thenable | medium | @typescript-eslint | await-thenable | new | js/ts |
| bugs/deterministic/unhandled-promise | Unhandled promise | Promise-like statement not handled (missing await, .catch, or void) | high | @typescript-eslint | no-floating-promises | new | js/ts |
| bugs/deterministic/misused-promise | Misused promise | Promise used in place not designed for it (e.g., in conditionals without await) | high | @typescript-eslint | no-misused-promises | new | js/ts |
| bugs/deterministic/for-in-array | For-in loop on array | Using for-in to iterate an array (iterates keys, not values) | high | @typescript-eslint, sonarjs | no-for-in-array, S4619, S4139 | new | js/ts |
| bugs/deterministic/misused-spread | Misused spread operator | Spreading values that should not be spread (e.g., spreading a string into array) | medium | @typescript-eslint | no-misused-spread | new | js/ts |
| bugs/deterministic/restrict-plus-operands | Mismatched addition operands | Addition operands must be same type: both bigint, number, or string | medium | @typescript-eslint | restrict-plus-operands | new | js/ts |
| bugs/deterministic/restrict-template-expressions | Invalid template expression | Non-string value interpolated in template literal without toString | medium | @typescript-eslint | restrict-template-expressions | new | js/ts |
| bugs/deterministic/base-to-string | Useless toString | Calling toString on object that does not provide useful string representation | medium | @typescript-eslint | no-base-to-string | new | js/ts |
| bugs/deterministic/unsafe-enum-comparison | Unsafe enum comparison | Comparing enum value with non-enum value | medium | @typescript-eslint | no-unsafe-enum-comparison | new | js/ts |
| bugs/deterministic/mixed-enum-values | Mixed enum members | Enum has both number and string members | medium | @typescript-eslint | no-mixed-enums | new | js/ts |
| bugs/deterministic/unbound-method | Unbound method reference | Class method referenced without binding loses its this context | high | @typescript-eslint | unbound-method | new | js/ts |
| bugs/deterministic/unsafe-declaration-merging | Unsafe declaration merging | Interface and class with same name can merge unsafely | medium | @typescript-eslint | no-unsafe-declaration-merging | new | js/ts |
| bugs/deterministic/unsafe-unary-minus | Unsafe unary minus | Unary minus on non-numeric/non-bigint type | high | @typescript-eslint | no-unsafe-unary-minus | new | js/ts |
| bugs/deterministic/only-throw-error | Non-Error thrown | Throwing non-Error values as exceptions loses stack trace | medium | @typescript-eslint, eslint | only-throw-error, no-throw-literal | new | js/ts |
| bugs/deterministic/promise-reject-non-error | Promise rejected with non-Error | Rejecting a promise with a non-Error value | medium | eslint, @typescript-eslint | prefer-promise-reject-errors | new | js/ts |
| bugs/deterministic/switch-exhaustiveness | Non-exhaustive switch | Switch on union/enum type does not cover all possible values | medium | @typescript-eslint | switch-exhaustiveness-check | new | js/ts |
| bugs/deterministic/try-promise-catch | Promise caught by try block | Promise rejection caught by try block instead of .catch() | medium | sonarjs | S4822 (no-try-promise) | new | js/ts |
| bugs/deterministic/reduce-missing-initial | Array.reduce missing initial value | Array.reduce() called without initial value | medium | sonarjs | S6959 (reduce-initial-value) | new | js/ts |
| bugs/deterministic/array-sort-without-compare | Array sorted without comparator | Array.sort() or .toSorted() called without compare function (lexicographic sort) | medium | sonarjs, @typescript-eslint | S2871 (no-alphabetical-sort), require-array-sort-compare | new | js/ts |
| bugs/deterministic/misused-new-keyword | Misused new keyword | Defining constructor for interfaces or new for classes | high | @typescript-eslint | no-misused-new | new | js/ts |
| bugs/deterministic/contradictory-non-null-coalescing | Contradictory non-null coalescing | Non-null assertion with nullish coalescing (x! ?? y) | high | @typescript-eslint | no-non-null-asserted-nullish-coalescing | new | js/ts |
| bugs/deterministic/contradictory-optional-chain | Contradictory optional chain | Non-null assertion after optional chain (x?.y!) | high | @typescript-eslint | no-non-null-asserted-optional-chain | new | js/ts |
| bugs/deterministic/empty-object-type | Empty object type | Using {} type which matches everything except null/undefined | high | @typescript-eslint | no-empty-object-type | new | js/ts |
| bugs/deterministic/wrapper-object-type | Wrapper object type | Using String/Number/Boolean types instead of primitives | high | @typescript-eslint | no-wrapper-object-types | new | js/ts |
| bugs/deterministic/duplicate-enum-value | Duplicate enum value | Duplicate values in enum members | high | @typescript-eslint | no-duplicate-enum-values | new | js/ts |
| bugs/deterministic/invalid-void-type | Invalid void type | Using void type outside of generic or return type position | medium | @typescript-eslint | no-invalid-void-type | new | js/ts |
| bugs/deterministic/confusing-non-null-assertion | Confusing non-null assertion | x! == y looks like x !== y | medium | @typescript-eslint | no-confusing-non-null-assertion | new | js/ts |
| bugs/deterministic/getter-setter-type-mismatch | Getter setter type mismatch | Getter return type doesn't match setter parameter type | medium | @typescript-eslint | related-getter-setter-pairs | new | js/ts |
| bugs/deterministic/fragile-enum-ordering | Fragile enum ordering | Enum members without explicit initializers | medium | @typescript-eslint | prefer-enum-initializers | new | js/ts |
| bugs/deterministic/missing-return-await | Missing return await | Missing await in try/catch return loses stack trace | medium | @typescript-eslint | return-await | new | js/ts |
| bugs/deterministic/loose-boolean-expression | Loose boolean expression | Non-boolean values in boolean contexts | medium | @typescript-eslint | strict-boolean-expressions | new | js/ts |
| bugs/deterministic/unsafe-type-assertion | Unsafe type assertion | Type assertion that unsafely narrows a type, hiding type errors | high | @typescript-eslint | no-unsafe-type-assertion | new | js/ts |
| bugs/deterministic/void-return-value | Void return value | Returning non-void value from void function — return value silently discarded | medium | @typescript-eslint | strict-void-return | new | js/ts |

---

## Code Quality

Rules about complexity, code smells, maintainability, naming, duplication.

### Code Quality / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/deterministic/long-method | Long method | Function has too many statements (>30) | low | truecourse-existing, sonarjs, eslint | arch/long-method, S138 (max-lines-per-function), max-lines-per-function | existing | all |
| code-quality/deterministic/too-many-parameters | Too many parameters | Function has 5 or more parameters, needs refactoring | low | truecourse-existing, sonarjs, eslint, @typescript-eslint | arch/too-many-parameters, max-params | existing | all |
| code-quality/deterministic/deeply-nested-logic | Deeply nested logic | Function has excessive nesting depth (>4 levels) | medium | truecourse-existing, sonarjs | arch/deeply-nested-logic, S134 (nested-control-flow) | existing | all |
| code-quality/deterministic/dead-method | Dead method | Method has no incoming or outgoing calls — likely unused | low | truecourse-existing | arch/dead-method | existing | all |
| code-quality/deterministic/empty-catch | Empty catch block | Catch block swallows errors silently | medium | truecourse-existing, sonarjs | code/empty-catch, S2486 (no-ignored-exceptions) | existing | js/ts, python |
| code-quality/deterministic/console-log | Console log in production | console.log/debug calls should be replaced with proper logger | low | truecourse-existing, eslint | code/console-log, no-console | existing | js/ts, python |
| code-quality/deterministic/explicit-any | Explicit any type | Using :any bypasses TypeScript type checking | medium | truecourse-existing, @typescript-eslint | code/no-explicit-any, no-explicit-any | existing | js/ts, python |
| code-quality/deterministic/var-declaration | var declaration | Using var instead of let/const (function-scoped, not block-scoped) | medium | truecourse-existing, eslint | code/global-statement, no-var | existing | js/ts |
| code-quality/deterministic/global-statement | Global state mutation | Using global/nonlocal keyword to modify module-level state from inside a function | medium | truecourse-existing | code/global-statement | existing | python |
| code-quality/deterministic/todo-fixme | TODO/FIXME comment | Unresolved TODO, FIXME, HACK, or XXX comment in codebase | low | truecourse-existing, sonarjs, ruff, eslint, sonar-python | code/todo-fixme, S1135 (todo-tag), S1134 (fixme-tag), FIX003 (LineContainsXxx), no-warning-comments, S1707 | existing | all |
| code-quality/deterministic/cognitive-complexity | High cognitive complexity | Function has high cognitive complexity, hard to understand | medium | sonarjs, sonar-python | S3776 (cognitive-complexity) | new | all |
| code-quality/deterministic/cyclomatic-complexity | High cyclomatic complexity | Function has too many independent code paths | medium | sonarjs, sonar-python, eslint, ruff | S1541 (cyclomatic-complexity), FunctionComplexity, C901 (ComplexStructure), complexity | new | all |
| code-quality/deterministic/expression-complexity | Complex expression | Expression with too many operators, hard to understand | medium | sonarjs | S1067 (expression-complexity) | new | js/ts |
| code-quality/deterministic/too-many-lines | File too long | File has too many lines of code | low | sonarjs, eslint | S104 (max-lines), max-lines | new | all |
| code-quality/deterministic/too-many-return-statements | Too many return statements | Function has too many return statements | low | sonar-python, ruff | S1142, PLR0911 (TooManyReturnStatements) | new | python |
| code-quality/deterministic/too-many-branches | Too many branches | Function has too many branches | low | ruff | PLR0912 (TooManyBranches) | new | python |
| code-quality/deterministic/too-many-switch-cases | Too many switch cases | Switch statement with too many case clauses | low | sonarjs | S1479 (max-switch-cases) | new | js/ts |
| code-quality/deterministic/too-many-union-members | Too many union members | Union type with too many elements, hard to maintain | low | sonarjs | S4622 (max-union-size) | new | js/ts |
| code-quality/deterministic/nested-ternary | Nested ternary | Ternary operators nested inside each other | medium | eslint, sonarjs, sonar-python | no-nested-ternary, S3358 (no-nested-conditional) | new | all |
| code-quality/deterministic/nested-switch | Nested switch | Switch statement inside another switch statement | medium | sonarjs | S1821 (no-nested-switch) | new | js/ts |
| code-quality/deterministic/nested-template-literal | Nested template literal | Template literals nested inside other template literals | low | sonarjs | S4624 (no-nested-template-literals) | new | js/ts |
| code-quality/deterministic/deeply-nested-functions | Deeply nested functions | Functions nested too many levels deep | medium | sonarjs | S2004 (no-nested-functions) | new | js/ts |
| code-quality/deterministic/too-many-breaks | Too many breaks in loop | Loop with multiple break or continue statements | low | sonarjs | S135 (too-many-break-or-continue-in-loop) | new | js/ts |
| code-quality/deterministic/duplicate-string | Duplicate string literal | Same string literal duplicated across the codebase | low | sonarjs, sonar-python | S1192 (no-duplicate-string) | new | all |
| code-quality/deterministic/identical-functions | Identical functions | Multiple functions with identical implementations | medium | sonarjs, sonar-python | S4144 (no-identical-functions) | new | all |
| code-quality/deterministic/unused-variable | Unused variable | Local variable or function declared but never used | low | eslint, sonarjs, sonar-python, ruff, @typescript-eslint | no-unused-vars, S1481 (no-unused-vars), F841 (UnusedVariable) | new | all |
| code-quality/deterministic/unused-private-member | Unused private class member | Private class field or method never referenced | low | eslint, @typescript-eslint | no-unused-private-class-members | new | js/ts |
| code-quality/deterministic/unused-expression | Unused expression | Expression that is computed but result is never used | low | eslint, @typescript-eslint | no-unused-expressions | new | js/ts |
| code-quality/deterministic/dead-store | Dead store | Variable assigned a value that is never read | low | sonarjs, sonar-python, eslint | S1854 (no-dead-store), no-useless-assignment | new | all |
| code-quality/deterministic/unused-collection | Unused collection | Collection created and populated but never read | low | sonarjs | S4030 (no-unused-collection) | new | js/ts |
| code-quality/deterministic/redundant-assignment | Redundant assignment | Assignment that has no effect because variable already holds that value | low | sonarjs | S4165 (no-redundant-assignments) | new | js/ts |
| code-quality/deterministic/redundant-boolean | Redundant boolean literal | Boolean literals used unnecessarily in comparisons | low | sonarjs, eslint | S1125 (no-redundant-boolean), no-extra-boolean-cast | new | js/ts |
| code-quality/deterministic/redundant-jump | Redundant jump statement | return, break, or continue that has no effect | low | sonarjs, sonar-python, eslint, ruff | S3626 (no-redundant-jump), no-useless-return, PLR1711 (UselessReturn) | new | all |
| code-quality/deterministic/useless-catch | Useless catch | Catch/except clause that just rethrows the exception without modification | low | eslint, sonarjs, sonar-python | no-useless-catch, S2737 (no-useless-catch) | new | all |
| code-quality/deterministic/useless-constructor | Useless constructor | Empty constructor or one that just calls super() | low | eslint, sonarjs, @typescript-eslint | no-useless-constructor | new | js/ts |
| code-quality/deterministic/useless-escape | Useless escape | Escape character in string/regex that is not necessary | low | eslint | no-useless-escape | new | js/ts |
| code-quality/deterministic/useless-rename | Useless rename | Import/export/destructuring rename to the same name | low | eslint | no-useless-rename | new | js/ts |
| code-quality/deterministic/useless-computed-key | Useless computed key | Computed property key that is a static value | low | eslint | no-useless-computed-key | new | js/ts |
| code-quality/deterministic/useless-concat | Useless concatenation | Unnecessary concatenation of string literals | low | eslint | no-useless-concat | new | js/ts |
| code-quality/deterministic/strict-equality | Loose equality | Using == or != instead of === or !== | medium | eslint | eqeqeq | new | js/ts |
| code-quality/deterministic/debugger-statement | Debugger statement | debugger/breakpoint() statement left in code | high | eslint, ruff | no-debugger, T100 (Debugger) | new | all |
| code-quality/deterministic/alert-usage | Alert/confirm/prompt usage | Using browser alert, confirm, or prompt dialogs | low | eslint | no-alert | new | js/ts |
| code-quality/deterministic/commented-out-code | Commented out code | Sections of code that are commented out instead of removed | low | sonarjs, sonar-python, ruff | S125 (no-commented-code), ERA001 (CommentedOutCode) | new | all |
| code-quality/deterministic/empty-function | Empty function | Function body is empty with no implementation | low | eslint, sonarjs, sonar-python, @typescript-eslint | no-empty-function, no-empty, S1186 | new | all |
| code-quality/deterministic/collapsible-if | Collapsible if statements | Nested if statements that could be merged into one | low | sonarjs, sonar-python, ruff | S1066 (no-collapsible-if), SIM102 (CollapsibleIf) | new | all |
| code-quality/deterministic/inverted-boolean | Inverted boolean check | Boolean check that is unnecessarily inverted | low | sonarjs | S1940 (no-inverted-boolean-check) | new | js/ts |
| code-quality/deterministic/prefer-single-boolean-return | Wrapping boolean in if-else | Returning boolean literal from if-else instead of the condition | low | sonarjs | S1126 (prefer-single-boolean-return) | new | js/ts |
| code-quality/deterministic/prefer-immediate-return | Unnecessary temporary variable | Local variable declared only to be immediately returned | low | sonarjs | S1488 (prefer-immediate-return) | new | js/ts |
| code-quality/deterministic/prefer-while | For loop as while | For loop without init/update that should be a while loop | low | sonarjs | S1264 (prefer-while) | new | js/ts |
| code-quality/deterministic/prefer-const | Reassignment-free let | Variable declared with let but never reassigned (should be const) | low | eslint | prefer-const | new | js/ts |
| code-quality/deterministic/prefer-template | String concatenation over template | Using string concatenation where template literal is cleaner | low | eslint | prefer-template | new | js/ts |
| code-quality/deterministic/prefer-rest-params | Arguments object usage | Using arguments object instead of rest parameters | low | eslint, sonarjs | prefer-rest-params, S3513 (arguments-usage) | new | js/ts |
| code-quality/deterministic/prefer-spread | Apply instead of spread | Using .apply() where spread operator is cleaner | low | eslint | prefer-spread | new | js/ts |
| code-quality/deterministic/prefer-object-spread | Object.assign instead of spread | Using Object.assign with literal first arg instead of spread | low | eslint | prefer-object-spread | new | js/ts |
| code-quality/deterministic/parameter-reassignment | Parameter reassignment | Reassigning function parameters makes intent unclear | medium | eslint, sonarjs, sonar-python | no-param-reassign, S1226 (no-parameter-reassignment) | new | all |
| code-quality/deterministic/variable-shadowing | Variable shadowing | Variable declaration shadows outer scope variable | medium | eslint, sonarjs, @typescript-eslint | no-shadow, S2137 (no-globals-shadowing) | new | js/ts |
| code-quality/deterministic/magic-number | Magic number | Undocumented numeric literal in code | low | eslint, @typescript-eslint | no-magic-numbers | new | js/ts |
| code-quality/deterministic/use-before-define | Variable use before definition | Using a variable before it is defined | medium | eslint, sonarjs, @typescript-eslint | no-use-before-define, S1526 (no-variable-usage-before-declaration), S3827 (no-reference-error) | new | js/ts |
| code-quality/deterministic/labels-usage | Labels usage | Using labeled statements (hard to follow control flow) | low | eslint, sonarjs | no-labels, S1119 (no-labels) | new | js/ts |
| code-quality/deterministic/extend-native | Extending native types | Modifying prototype of built-in objects | high | eslint, sonarjs | no-extend-native, S2424 (no-built-in-override) | new | js/ts |
| code-quality/deterministic/primitive-wrapper | Primitive wrapper object | Using new String(), new Number(), etc. instead of primitives | medium | eslint, sonarjs | no-new-wrappers, S1533 (no-primitive-wrappers) | new | js/ts |
| code-quality/deterministic/array-constructor | Array constructor | Using Array constructor instead of literal syntax | low | eslint, sonarjs, @typescript-eslint | no-array-constructor, S1528 (array-constructor) | new | js/ts |
| code-quality/deterministic/function-in-loop | Function defined in loop | Function defined inside loop — in Python, closures capture loop variable by reference causing bugs | medium | eslint, sonarjs, sonar-python, ruff | no-loop-func, S1515 (function-inside-loop), B023 | new | all |
| code-quality/deterministic/inconsistent-function-call | Inconsistent new usage | Function called both with and without new keyword | medium | sonarjs | S3686 (inconsistent-function-call) | new | js/ts |
| code-quality/deterministic/multi-assign | Chained assignment | Chained assignment expressions that are hard to read | low | eslint | no-multi-assign | new | js/ts |
| code-quality/deterministic/bitwise-in-boolean | Bitwise operator in boolean context | Using bitwise operator where logical operator was likely intended | medium | sonarjs, eslint | S1529 (bitwise-operators), no-bitwise | new | js/ts |
| code-quality/deterministic/for-in-without-filter | for-in without filter | for-in loop without hasOwnProperty check iterates inherited properties | medium | eslint, sonarjs | guard-for-in, S1535 (for-in) | new | js/ts |
| code-quality/deterministic/with-statement | With statement | Using with statement which is confusing and deprecated | high | eslint | no-with | new | js/ts |
| code-quality/deterministic/default-case-last | Default case not last | Default clause in switch should be last for readability | low | eslint, sonarjs | default-case-last, S4524 (prefer-default-last) | new | js/ts |
| code-quality/deterministic/elseif-without-else | else-if without else | if-else-if chain without final else clause | low | sonarjs | S126 (elseif-without-else) | new | js/ts |
| code-quality/deterministic/block-scoped-var | Variable used outside block | Variable declared in one block accessed in another | medium | eslint, sonarjs | block-scoped-var, S2392 (block-scoped-var) | new | js/ts |
| code-quality/deterministic/accessor-pairs | Missing getter or setter | Object has setter without getter or vice versa | medium | eslint | accessor-pairs | new | js/ts |
| code-quality/deterministic/no-return-assign | Assignment in return | Assignment expression inside return statement | medium | eslint | no-return-assign | new | js/ts |
| code-quality/deterministic/no-sequences | Comma operator | Using comma operator which makes code harder to read | low | eslint | no-sequences | new | js/ts |
| code-quality/deterministic/no-void | Void operator usage | Using void operator which is unnecessary in modern JS | low | eslint, sonarjs | no-void, S3735 (void-use) | new | js/ts |
| code-quality/deterministic/no-script-url | javascript: URL | Using javascript: URL is equivalent to eval | high | eslint | no-script-url | new | js/ts |
| code-quality/deterministic/no-proto | __proto__ usage | Using __proto__ property instead of Object.getPrototypeOf | low | eslint | no-proto | new | js/ts |
| code-quality/deterministic/no-caller | arguments.caller usage | Using arguments.caller or arguments.callee | medium | eslint | no-caller | new | js/ts |
| code-quality/deterministic/no-iterator | __iterator__ usage | Using __iterator__ property which is non-standard | low | eslint | no-iterator | new | js/ts |
| code-quality/deterministic/deprecated-api-usage | Deprecated API usage | Using code marked as @deprecated | medium | sonarjs, @typescript-eslint | S1874 (deprecation), no-deprecated | new | js/ts |
| code-quality/deterministic/require-yield | Generator without yield | Generator function that never yields | medium | eslint, sonarjs | require-yield, S3531 (generator-without-yield) | new | js/ts |
| code-quality/deterministic/require-await | Async without await | Async function that never uses await | low | eslint, @typescript-eslint | require-await | new | js/ts |
| code-quality/deterministic/class-prototype-assignment | Prototype assignment in class | Using prototype assignments instead of class methods | low | sonarjs | S3525 (class-prototype) | new | js/ts |
| code-quality/deterministic/multiline-block-without-braces | Multiline block without braces | Multiple statements indented under if/for without enclosing braces | high | sonarjs | S2681 (no-unenclosed-multiline-block) | new | js/ts |
| code-quality/deterministic/case-without-break | Case label in switch without break | Non-case label inside switch statement | medium | sonarjs | S1219 (no-case-label-in-switch) | new | js/ts |
| code-quality/deterministic/function-in-block | Function declaration in block | Function declaration inside if/while/for block | medium | eslint, sonarjs | no-inner-declarations, S1530 (no-function-declaration-in-block) | new | js/ts |
| code-quality/deterministic/implicit-global | Implicit global variable | Variable assigned without declaration (creates global) | high | sonarjs | S2703 (no-implicit-global) | new | js/ts |
| code-quality/deterministic/public-static-readonly | Mutable public static field | Public static fields should be read-only | medium | sonarjs | S1444 (public-static-readonly) | new | js/ts |
| code-quality/deterministic/redundant-type-alias | Redundant type alias | Type alias that just wraps another type without adding meaning | low | sonarjs | S6564 (redundant-type-aliases) | new | js/ts |
| code-quality/deterministic/redundant-optional | Redundant optional | Property declared with both ? and undefined type | low | sonarjs | S4782 (no-redundant-optional) | new | js/ts |
| code-quality/deterministic/useless-type-intersection | Useless type intersection | Type intersection that produces never or has no effect | low | sonarjs | S4335 (no-useless-intersection) | new | js/ts |
| code-quality/deterministic/duplicate-type-constituent | Duplicate type constituent | Union or intersection type with duplicate members | low | sonarjs, @typescript-eslint | S4621 (no-duplicate-in-composite), no-duplicate-type-constituents, no-redundant-type-constituents | new | js/ts |
| code-quality/deterministic/undefined-passed-as-optional | Undefined as optional argument | Passing undefined explicitly as value of optional parameter | low | sonarjs | S4623 (no-undefined-argument) | new | js/ts |
| code-quality/deterministic/undefined-assignment | Undefined assignment | Assigning undefined to a variable instead of using delete/uninitialized | low | sonarjs | S2138 (no-undefined-assignment) | new | js/ts |
| code-quality/deterministic/associative-array | Associative array | Using array indexes as strings instead of using an object/Map | medium | sonarjs | S3579 (no-associative-arrays) | new | js/ts |
| code-quality/deterministic/selector-parameter | Selector parameter | Boolean parameter that controls function behavior (should be two functions) | low | sonarjs | S2301 (no-selector-parameter) | new | js/ts |
| code-quality/deterministic/equals-in-for-termination | Equality in for termination | Using == or === in for loop termination (may overshoot) | low | sonarjs | S888 (no-equals-in-for-termination) | new | js/ts |
| code-quality/deterministic/regex-complexity | Complex regular expression | Regular expression that is too complicated to understand | medium | sonarjs | S5843 (regex-complexity) | new | js/ts |
| code-quality/deterministic/regex-empty-group | Empty regex group | Regular expression contains empty group () | low | sonarjs | S6331 (no-empty-group) | new | js/ts |
| code-quality/deterministic/regex-empty-alternative | Empty regex alternative | Regular expression contains empty alternative in alternation | low | sonarjs | S6323 (no-empty-alternatives) | new | js/ts |
| code-quality/deterministic/regex-empty-repetition | Empty string repetition | Repeated pattern can match empty string (possible infinite match) | low | sonarjs | S5842 (empty-string-repetition) | new | js/ts |
| code-quality/deterministic/regex-single-char-class | Single character class | Character class with only one character should be the character itself | low | sonarjs | S6397 (single-char-in-character-classes) | new | js/ts |
| code-quality/deterministic/regex-single-char-alternation | Single character alternation | Alternation of single characters should be a character class | low | sonarjs | S6035 (single-character-alternation) | new | js/ts |
| code-quality/deterministic/regex-duplicate-char-class | Duplicate character in class | Character class contains the same character twice | low | sonarjs | S5869 (duplicates-in-character-class) | new | js/ts |
| code-quality/deterministic/regex-unused-group | Unused named group | Named regex group that is never referenced | low | sonarjs | S5860 (unused-named-groups) | new | js/ts |
| code-quality/deterministic/regex-anchor-precedence | Regex anchor precedence | Anchors in regex should use groups to avoid ambiguity with alternation | low | sonarjs | S5850 (anchor-precedence) | new | js/ts |
| code-quality/deterministic/regex-concise | Verbose regex | Regex quantifiers or character classes that could be written more concisely | low | sonarjs | S6353 (concise-regex) | new | js/ts |
| code-quality/deterministic/regex-unicode-awareness | Missing unicode flag | Regex with Unicode character classes should enable the unicode flag | low | sonarjs | S5867 (unicode-aware-regex) | new | js/ts |
| code-quality/deterministic/prefer-regex-exec | String.match without global flag | RegExp.exec() should be preferred over String.match() when no global flag | low | sonarjs, @typescript-eslint | S6594 (prefer-regexp-exec), prefer-regexp-exec | new | js/ts |
| code-quality/deterministic/prefer-includes | indexOf for existence check | Using indexOf() !== -1 instead of includes() | low | @typescript-eslint | prefer-includes | new | js/ts |
| code-quality/deterministic/prefer-optional-chain | Chained logical and | Chained logical ands for null checks instead of optional chaining | low | @typescript-eslint | prefer-optional-chain | new | js/ts |
| code-quality/deterministic/prefer-nullish-coalescing | Logical or for default | Using logical OR for defaults instead of nullish coalescing | low | @typescript-eslint | prefer-nullish-coalescing | new | js/ts |
| code-quality/deterministic/ban-ts-comment | Unscoped ts-comment | @ts-ignore or @ts-nocheck without description | medium | @typescript-eslint | ban-ts-comment | new | js/ts |
| code-quality/deterministic/non-null-assertion | Non-null assertion | Using ! postfix to assert non-null (bypasses type safety) | medium | @typescript-eslint | no-non-null-assertion | new | js/ts |
| code-quality/deterministic/unsafe-any-usage | Unsafe any usage | Using a value typed as any in assignments, calls, returns, or member access | medium | @typescript-eslint | no-unsafe-argument, no-unsafe-assignment, no-unsafe-call, no-unsafe-member-access, no-unsafe-return | new | js/ts |
| code-quality/deterministic/unnecessary-type-assertion | Unnecessary type assertion | Type assertion that does not change the expression type | low | @typescript-eslint | no-unnecessary-type-assertion | new | js/ts |
| code-quality/deterministic/unnecessary-condition | Always-truthy or always-falsy condition | Conditional check on value whose type makes it always truthy/falsy | medium | @typescript-eslint | no-unnecessary-condition | new | js/ts |
| code-quality/deterministic/unnecessary-boolean-compare | Unnecessary boolean comparison | Comparing boolean to true/false explicitly | low | @typescript-eslint | no-unnecessary-boolean-literal-compare | new | js/ts |
| code-quality/deterministic/confusing-void-expression | Confusing void expression | Expression of type void used in non-statement position | low | @typescript-eslint | no-confusing-void-expression | new | js/ts |
| code-quality/deterministic/no-extraneous-class | Class used as namespace | Class with only static members should be a module | low | @typescript-eslint | no-extraneous-class | new | js/ts |
| code-quality/deterministic/explicit-any-in-return | Explicit any return type | Function returns any when a specific type should be declared | medium | sonarjs | S4324 (no-return-type-any) | new | js/ts |
| code-quality/deterministic/string-comparison | String comparison with operators | Comparing strings with < > operators instead of localeCompare | low | sonarjs | S3003 (strings-comparison) | new | js/ts |
| code-quality/deterministic/unnecessary-bind | Unnecessary bind | Unnecessary .bind() on functions that don't use this | low | eslint | no-extra-bind | new | js/ts |
| code-quality/deterministic/unnecessary-block | Unnecessary block | Nested blocks that serve no purpose | low | eslint | no-lone-blocks | new | js/ts |
| code-quality/deterministic/unnecessary-call-apply | Unnecessary call apply | Unnecessary .call() and .apply() | low | eslint | no-useless-call | new | js/ts |
| code-quality/deterministic/implicit-type-coercion | Implicit type coercion | Shorthand type conversions like !!val, +str | low | eslint | no-implicit-coercion | new | js/ts |
| code-quality/deterministic/deep-callback-nesting | Deep callback nesting | Deeply nested callbacks (callback hell) | medium | eslint | max-nested-callbacks | new | js/ts |
| code-quality/deterministic/too-many-classes-per-file | Too many classes per file | Too many classes in one file | low | eslint | max-classes-per-file | new | js/ts |
| code-quality/deterministic/static-method-candidate | Static method candidate | Class method that doesn't use this should be static | low | eslint | class-methods-use-this | new | js/ts |
| code-quality/deterministic/default-parameter-position | Default parameter position | Default parameters should be last | low | eslint | default-param-last | new | js/ts |
| code-quality/deterministic/unnamed-regex-capture | Unnamed regex capture | Regex capture groups should be named for clarity | low | eslint | prefer-named-capture-group | new | js/ts |
| code-quality/deterministic/unnecessary-regex-constructor | Unnecessary regex constructor | Static regex patterns should use literal syntax | low | eslint | prefer-regex-literals | new | js/ts |
| code-quality/deterministic/ungrouped-accessor-pair | Ungrouped accessor pair | Getter and setter not placed together | low | eslint | grouped-accessor-pairs | new | js/ts |
| code-quality/deterministic/this-aliasing | This aliasing | Unnecessary aliasing of this to a variable | low | @typescript-eslint | no-this-alias | new | js/ts |
| code-quality/deterministic/require-import | Require import | Using require() or AMD define() in TypeScript instead of import | low | @typescript-eslint, sonarjs | no-require-imports, S3533 | new | js/ts |
| code-quality/deterministic/namespace-usage | Namespace usage | Using TypeScript namespace keyword instead of ES modules | low | @typescript-eslint | no-namespace | new | js/ts |
| code-quality/deterministic/unsafe-function-type | Unsafe function type | Using the broad Function type instead of specific signature | medium | @typescript-eslint | no-unsafe-function-type | new | js/ts |
| code-quality/deterministic/redundant-type-constraint | Redundant type constraint | Type constraint (extends any/unknown) that is redundant | low | @typescript-eslint | no-unnecessary-type-constraint | new | js/ts |
| code-quality/deterministic/literal-assertion-over-const | Literal assertion over const | Should use as const over literal type assertion | low | @typescript-eslint | prefer-as-const | new | js/ts |
| code-quality/deterministic/indexed-loop-over-for-of | Indexed loop over for-of | Indexed for loop when index is not needed | low | @typescript-eslint | prefer-for-of | new | js/ts |
| code-quality/deterministic/interface-over-function-type | Interface over function type | Interface with only call signature should be function type | low | @typescript-eslint | prefer-function-type | new | js/ts |
| code-quality/deterministic/filter-first-over-find | Filter first over find | Using filter()[0] instead of find() | low | @typescript-eslint | prefer-find | new | js/ts |
| code-quality/deterministic/substring-over-starts-ends | Substring over starts ends | Using substring checks instead of startsWith/endsWith | low | @typescript-eslint | prefer-string-starts-ends-with | new | js/ts |
| code-quality/deterministic/mutable-private-member | Mutable private member | Private members never reassigned should be readonly | low | @typescript-eslint | prefer-readonly | new | js/ts |
| code-quality/deterministic/triple-slash-reference | Triple slash reference | Using /// reference instead of imports | low | @typescript-eslint | triple-slash-reference | new | js/ts |
| code-quality/deterministic/redundant-overload | Redundant overload | Two function overloads that could be unified | low | @typescript-eslint | unified-signatures | new | js/ts |
| code-quality/deterministic/computed-enum-value | Computed enum value | Enum values should be literals, not computed | low | @typescript-eslint | prefer-literal-enum-member | new | js/ts |
| code-quality/deterministic/useless-empty-export | Useless empty export | Empty export {} that does nothing | low | @typescript-eslint | no-useless-empty-export | new | js/ts |
| code-quality/deterministic/unknown-catch-variable | Unknown catch variable | Catch callback variables should be typed as unknown | low | @typescript-eslint | use-unknown-in-catch-callback-variable | new | js/ts |
| code-quality/deterministic/redundant-template-expression | Redundant template expression | Template literal with only a variable and no text | low | @typescript-eslint | no-unnecessary-template-expression | new | js/ts |
| code-quality/deterministic/redundant-type-argument | Redundant type argument | Type argument that matches the default | low | @typescript-eslint | no-unnecessary-type-arguments | new | js/ts |
| code-quality/deterministic/async-promise-function | Async promise function | Functions returning Promise should be marked async | low | @typescript-eslint | promise-function-async | new | js/ts |
| code-quality/deterministic/meaningless-void-operator | Meaningless void operator | void used on already-void expression | low | @typescript-eslint | no-meaningless-void-operator | new | js/ts |
| code-quality/deterministic/dynamic-delete | Dynamic delete | delete on computed key expressions | low | @typescript-eslint | no-dynamic-delete | new | js/ts |
| code-quality/deterministic/type-guard-preference | Type guard preference | Type predicates should be used for type narrowing | low | sonarjs | S4322 | new | js/ts |
| code-quality/deterministic/complex-type-alias | Complex type alias | Complex types should use type aliases | low | sonarjs | S4323 | new | js/ts |
| code-quality/deterministic/unnecessary-promise-wrap | Unnecessary promise wrap | Using new Promise when resolve/reject shorthand suffices | low | sonarjs | S4634 | new | js/ts |
| code-quality/deterministic/ungrouped-shorthand-properties | Ungrouped shorthand properties | Shorthand properties not grouped in object literals | low | sonarjs | S3499 | new | js/ts |
| code-quality/deterministic/filename-class-mismatch | Filename class mismatch | Default export name doesn't match filename | low | sonarjs | S3317 | new | js/ts |
| code-quality/deterministic/boolean-parameter-default | Boolean parameter default | Optional boolean parameters without default value | low | sonarjs | S4798 | new | js/ts |
| code-quality/deterministic/internal-api-usage | Internal API usage | Using internal/private APIs of libraries | medium | sonarjs | S6627 | new | js/ts |
| code-quality/deterministic/flaky-test | Flaky test | Tests should be deterministic and stable | medium | sonarjs | S5973 | new | js/ts |
| code-quality/deterministic/disabled-test-timeout | Disabled test timeout | Disabling test timeouts without explicit reason | low | sonarjs | S6080 | new | js/ts |
| code-quality/deterministic/empty-static-block | Empty static block | Empty static class block — dead code | low | eslint | no-empty-static-block | new | js/ts |
| code-quality/deterministic/collapsible-else-if | Collapsible else-if | if as only statement in else block should be else if | low | eslint | no-lonely-if | new | js/ts |
| code-quality/deterministic/negated-condition | Negated condition | Negated condition with else block should be inverted for readability | low | eslint | no-negated-condition | new | js/ts |
| code-quality/deterministic/verbose-object-constructor | Verbose object constructor | Using new Object() instead of {} literal | low | eslint | no-object-constructor | new | js/ts |
| code-quality/deterministic/unnecessary-else-after-return | Unnecessary else after return | else block after return statement is unnecessary | low | eslint | no-else-return | new | js/ts |
| code-quality/deterministic/trivial-ternary | Trivial ternary | Ternary that simplifies to the condition itself (x ? true : false) | low | eslint | no-unneeded-ternary | new | js/ts |
| code-quality/deterministic/legacy-has-own-property | Legacy hasOwnProperty | Should use Object.hasOwn() instead of hasOwnProperty.call() | low | eslint | prefer-object-has-own | new | js/ts |
| code-quality/deterministic/missing-destructuring | Missing destructuring | Not using destructuring from arrays/objects when applicable | low | eslint, sonarjs | prefer-destructuring, S3514 | new | js/ts |
| code-quality/deterministic/unused-constructor-result | Unused constructor result | new operator result unused — constructor called for side effects only | medium | eslint, sonarjs | no-new, S1848 | new | js/ts |
| code-quality/deterministic/prefer-object-literal | Prefer object literal | Creating empty object then assigning properties instead of literal | low | sonarjs | S2428 (prefer-object-literal) | new | js/ts |
| code-quality/deterministic/misleading-same-line-conditional | Misleading same-line conditional | Conditional on same line as previous block's closing brace — hides bugs | medium | sonarjs | S3972 (no-same-line-conditional) | new | js/ts |
| code-quality/deterministic/hardcoded-url | Hardcoded URL or endpoint | URL string literal in source code instead of configuration — cannot change per environment | medium | truecourse | - | new | all |
| code-quality/deterministic/magic-string | Magic string without named constant | String literal used as identifier/key in multiple places — should be a constant or enum | low | truecourse | - | new | all |
| code-quality/deterministic/missing-env-validation | Environment variable used without validation | process.env.X used directly without checking if it's defined — undefined at runtime | high | truecourse | - | new | js/ts |
| code-quality/deterministic/env-in-library-code | process.env access in library/domain code | Environment variables accessed deep in business logic instead of injected via configuration | medium | truecourse | - | new | js/ts |
| code-quality/deterministic/hardcoded-port | Hardcoded port number | Server listening on hardcoded port instead of configuration — conflicts in multi-service setup | low | truecourse | - | new | all |
| code-quality/deterministic/test-with-hardcoded-timeout | Test relying on setTimeout for async | Test using setTimeout or sleep to wait for async operation — flaky and slow | medium | truecourse | - | new | all |
| code-quality/deterministic/test-modifying-global-state | Test modifying global state without cleanup | Test modifies env vars, global objects, or module state without afterEach cleanup — pollutes other tests | high | truecourse | - | new | all |
| code-quality/deterministic/unpinned-dependency | Unpinned dependency version | Dependency using ^ or ~ range in production — builds may break from minor/patch updates | low | truecourse | - | new | js/ts |
| code-quality/deterministic/dev-dependency-in-production | Dev dependency imported in production code | Package listed in devDependencies but imported in src/ code — missing in production install | high | truecourse | - | new | js/ts |
| code-quality/deterministic/multiple-versions-same-package | Multiple versions of same package | Lock file shows multiple versions of same package — bundle bloat and potential behavior differences | low | truecourse | - | new | js/ts |
| code-quality/deterministic/missing-lockfile | Missing lock file | Project has package.json but no package-lock.json or pnpm-lock.yaml — non-reproducible builds | medium | truecourse | - | new | js/ts |
| code-quality/deterministic/unused-function-parameter | Unused function parameter | Unused function parameters should be removed | low | sonarjs, sonar-python, ruff | S1172 (no-unused-function-argument), ARG001-ARG005 (UnusedFunctionArgument/UnusedMethodArgument/UnusedClassMethodArgument/UnusedStaticMethodArgument/UnusedLambdaArgument) | new | all |
| code-quality/deterministic/regex-empty-after-reluctant | Regex empty after reluctant | Reluctant quantifier followed by expression that matches empty string | low | sonarjs | S6019 (no-empty-after-reluctant) | new | js/ts |
| code-quality/deterministic/regex-multiple-spaces | Regex multiple spaces | Multiple spaces in regex should use quantifier instead | low | sonarjs | S6326 (no-regex-spaces) | new | js/ts |
| code-quality/deterministic/trivial-switch | Trivial switch | Switch with only 1-2 cases should be an if statement | low | sonarjs | S1301 (no-small-switch) | new | js/ts |
| code-quality/deterministic/broad-exception-raised | Broad exception raised | Raising generic Exception or BaseException instead of specific exception class | medium | ruff, sonar-python | TRY002 (RaiseVanillaClass) | new | python |
| code-quality/deterministic/bare-raise-outside-except | Bare raise outside except block | raise without argument used outside except block — nothing to re-raise | high | ruff, sonar-python | PLE0704 (MisplacedBareRaise), S5747 | new | python |
| code-quality/deterministic/useless-else-on-loop | Useless else on loop | for/while loop with else clause but no break — else always executes | medium | ruff, sonar-python | PLW0120 (UselessElseOnLoop), S2836 | new | python |
| code-quality/deterministic/assert-in-production | Assert statement in production code | assert statements are removed when Python runs with -O flag — not reliable for validation | medium | ruff | S101 (Assert) | new | python |
| code-quality/deterministic/builtin-shadowing | Built-in name shadowed | Variable, argument, import, or lambda parameter shadows Python built-in name (list, dict, type, etc.) | medium | ruff, sonar-python | A001/A002/A003/A004/A005/A006 (BuiltinVariableShadowing/BuiltinArgumentShadowing/BuiltinAttributeShadowing/BuiltinImportShadowing/StdlibModuleShadowing/BuiltinLambdaArgumentShadowing), S5806 | new | python |
| code-quality/deterministic/abstract-class-without-abstract-method | Abstract base class without abstract method | Class inherits from ABC but defines no abstract methods — cannot enforce interface | medium | ruff | B024 (AbstractBaseClassWithoutAbstractMethod) | new | python |
| code-quality/deterministic/cached-instance-method | Cached instance method | Using @lru_cache on instance method — caches self, causes memory leak | high | ruff | B019 (CachedInstanceMethod) | new | python |
| code-quality/deterministic/unspecified-encoding | Unspecified file encoding | open() without explicit encoding parameter — behavior varies across platforms | medium | ruff | PLW1514 (UnspecifiedEncoding) | new | python |
| code-quality/deterministic/subprocess-run-without-check | subprocess.run without check | subprocess.run() without check=True — silently ignores non-zero exit codes | medium | ruff | PLW1510 (SubprocessRunWithoutCheck) | new | python |
| code-quality/deterministic/try-except-pass | Silent exception with pass | except block with only pass — silently swallows all errors | medium | ruff | S110 (TryExceptPass) | new | python |
| code-quality/deterministic/try-except-continue | Silent exception with continue | except block with only continue — silently ignores errors in loops | medium | ruff | S112 (TryExceptContinue) | new | python |
| code-quality/deterministic/system-exit-not-reraised | SystemExit not re-raised | Catching SystemExit without re-raising — prevents clean process shutdown | high | sonar-python | S5754 | new | python |
| code-quality/deterministic/any-type-hint | Any used as type hint | Using Any as type hint defeats type checking — use specific types | medium | ruff, sonar-python | ANN401 (AnyType), S6542 | new | python |
| code-quality/deterministic/open-file-without-context-manager | File opened without context manager | open() without with statement — file handle may not be closed on exception | medium | ruff | SIM115 (OpenFileWithContextHandler) | new | python |
| code-quality/deterministic/magic-value-comparison | Magic value comparison | Comparing against magic number/string literal instead of named constant | low | ruff | PLR2004 (MagicValueComparison) | new | python |
| code-quality/deterministic/unnecessary-lambda | Unnecessary lambda | Lambda that just calls a function with same arguments — use the function directly | low | ruff | PLW0108 (UnnecessaryLambda) | new | python |
| code-quality/deterministic/redefined-loop-name | Loop variable redefined in body | Loop variable reassigned inside loop body — likely a bug or confusing | low | ruff | PLW2901 (RedefinedLoopName) | new | python |
| code-quality/deterministic/import-private-name | Import of private name | Importing _private member from another module — not part of public API | medium | ruff | PLC2701 (ImportPrivateName) | new | python |
| code-quality/deterministic/private-member-access | External access to private member | Accessing _private attribute of another class or module | medium | ruff | SLF001 (PrivateMemberAccess) | new | python |
| code-quality/deterministic/eq-without-hash | __eq__ without __hash__ | Class defines __eq__ but not __hash__ — instances cannot be used in sets or as dict keys | medium | ruff | PLW1641 (EqWithoutHash) | new | python |
| code-quality/deterministic/useless-with-lock | Useless with-lock pattern | Creating a new Lock() in with statement — lock is never shared, provides no synchronization | high | ruff | PLW2101 (UselessWithLock) | new | python |
| code-quality/deterministic/return-type-inconsistent-with-hint | Return type inconsistent with type hint | Function return value type doesn't match declared return type hint | medium | sonar-python | S5886 | new | python |
| code-quality/deterministic/assignment-inconsistent-with-hint | Assignment inconsistent with type hint | Value assigned to variable doesn't match its type annotation | medium | sonar-python | S5890 | new | python |
| code-quality/deterministic/implicit-string-concatenation | Implicit string concatenation in collection | Adjacent string literals in list/tuple/set — likely missing comma | high | ruff | ISC004 (ImplicitStringConcatenationInCollectionLiteral) | new | python |
| code-quality/deterministic/print-statement-in-production | Print statement in production code | Using print() instead of proper logging — no log levels, no structured output | low | ruff | T201 (Print) | new | python |
| code-quality/deterministic/django-nullable-string-field | Django nullable string field | Using null=True on CharField/TextField in Django — use blank=True with default="" instead | medium | ruff, sonar-python | DJ001 (DjangoNullableModelStringField), S6553 | new | python |
| code-quality/deterministic/django-model-form-fields | Django ModelForm without explicit fields | ModelForm using fields = '__all__' or exclude — should list fields explicitly | medium | ruff, sonar-python | DJ006/DJ007 (DjangoExcludeWithModelForm/DjangoAllWithModelForm), S6559 | new | python |
| code-quality/deterministic/django-model-without-str | Django model without __str__ | Django model without __str__ method — admin and debug display show unhelpful object representation | low | ruff, sonar-python | DJ008 (DjangoModelWithoutDunderStr), S6554 | new | python |
| code-quality/deterministic/invalid-escape-sequence | Invalid escape sequence | Backslash in string that is not a valid escape sequence — use raw string or double backslash | medium | ruff | W605 (InvalidEscapeSequence) | new | python |
| code-quality/deterministic/unnecessary-pass | Unnecessary pass statement | pass in block that already has a body — redundant | low | sonar-python | S2772 | new | python |
| code-quality/deterministic/useless-expression | Useless expression statement | Expression computed but result never used — likely missing assignment or call | low | ruff, sonar-python | B015 (UselessComparison), B018 (UselessExpression), S905 | new | python |
| code-quality/deterministic/stop-iteration-in-generator | StopIteration raised in generator | Raising StopIteration inside a generator — use return instead (PEP 479) | high | ruff | PLR1708 (StopIterationReturn) | new | python |
| code-quality/deterministic/async-zero-sleep | Async zero-duration sleep | Using sleep(0) instead of checkpoint() in async code | low | ruff, sonar-python | ASYNC115 (AsyncZeroSleep), S7491 | new | python |
| code-quality/deterministic/async-long-sleep | Long sleep instead of sleep_forever | Using very long sleep durations instead of sleep_forever() or event.wait() | low | ruff, sonar-python | ASYNC116 (LongSleepNotForever), S7486 | new | python |
| code-quality/deterministic/async-unused-async | Async function without await | Async function that never uses await, async for, or async with — unnecessary async | low | ruff, sonar-python | RUF029 (UnusedAsync), S7503 | new | python |
| code-quality/deterministic/async-single-task-group | Single task in TaskGroup | TaskGroup/Nursery used for a single start call — unnecessary overhead | low | sonar-python | S7513 | new | python |
| code-quality/deterministic/getattr-with-constant | getattr with constant string | Using getattr(obj, "attr") instead of obj.attr — obscures attribute access | low | ruff | B009 (GetAttrWithConstant), B010 (SetAttrWithConstant), B043 (DelAttrWithConstant) | new | python |
| code-quality/deterministic/empty-method-without-abstract | Empty method without abstract decorator | Method in ABC with pass/ellipsis body but missing @abstractmethod — subclasses not forced to implement | medium | ruff | B027 (EmptyMethodWithoutAbstractDecorator) | new | python |
| code-quality/deterministic/class-as-data-structure | Class used as plain data structure | Class with only __init__ setting attributes — consider using dataclass or NamedTuple | low | ruff | B903 (ClassAsDataStructure) | new | python |
| code-quality/deterministic/unnecessary-generator-comprehension | Unnecessary generator in comprehension | Using list/set/dict constructor around generator when comprehension is clearer and faster | low | ruff, sonar-python | C400-C420 (UnnecessaryGenerator*/UnnecessaryLiteral*/UnnecessaryComprehension*), S7494, S7496, S7498, S7500, S7505 | new | python |
| code-quality/deterministic/raw-string-in-exception | String literal in exception constructor | Passing string literal directly to exception — use variable to avoid duplicate string in traceback | low | ruff | EM101 (RawStringInException), EM102 (FStringInException), EM103 (DotFormatInException) | new | python |
| code-quality/deterministic/boolean-trap | Boolean positional argument | Boolean parameter used as positional argument — caller intent is unclear (func(True) vs func(verbose=True)) | low | ruff | FBT001 (BooleanTypeHintPositionalArgument), FBT002 (BooleanDefaultValuePositionalArgument), FBT003 (BooleanPositionalValueInCall) | new | python |
| code-quality/deterministic/implicit-return | Inconsistent return statements | Function with mixed explicit/implicit returns — some paths return value, others fall through | low | ruff | RET501-RET503 (UnnecessaryReturnNone/ImplicitReturnValue/ImplicitReturn) | new | python |
| code-quality/deterministic/superfluous-else-after-control | Superfluous else after return/raise/break | else block after return/raise/continue/break — unnecessary nesting | low | ruff | RET505-RET508 (SuperfluousElseReturn/Raise/Continue/Break) | new | python |
| code-quality/deterministic/duplicate-isinstance-call | Duplicate isinstance calls | Multiple isinstance() calls that can be merged into one with a tuple | low | ruff | SIM101 (DuplicateIsinstanceCall), PLR1701 (RepeatedIsinstanceCalls) | new | python |
| code-quality/deterministic/needless-bool | Needless boolean conversion | if-else returning True/False can be simplified to return the condition directly | low | ruff | SIM103 (NeedlessBool), SIM210/SIM211/SIM212 | new | python |
| code-quality/deterministic/suppressible-exception | Suppressible exception with try-except-pass | try-except-pass can be replaced with contextlib.suppress() | low | ruff | SIM105 (SuppressibleException) | new | python |
| code-quality/deterministic/if-else-instead-of-ternary | if-else block instead of ternary | Simple if-else assigning different values can be a ternary expression | low | ruff | SIM108 (IfElseBlockInsteadOfIfExp) | new | python |
| code-quality/deterministic/compare-with-tuple | Multiple comparisons with or | Chained or comparisons (x == 1 or x == 2) should use tuple (x in (1, 2)) | low | ruff | SIM109 (CompareWithTuple), PLR1714 (RepeatedEqualityComparison) | new | python |
| code-quality/deterministic/reimplemented-builtin | Reimplemented builtin function | Loop reimplements any(), all(), min(), max(), itertools.starmap, or similar builtin — use the builtin directly | low | ruff | SIM110 (ReimplementedBuiltin), FURB140 (ReimplementedStarmap) | new | python |
| code-quality/deterministic/enumerate-for-loop | Manual index tracking in loop | Using manual counter variable instead of enumerate() | low | ruff | SIM113 (EnumerateForLoop) | new | python |
| code-quality/deterministic/if-with-same-arms | if/else with identical bodies | if and else branches have identical code — condition has no effect | medium | ruff | SIM114 (IfWithSameArms) | new | python |
| code-quality/deterministic/if-else-dict-lookup | if-else chain as dict lookup | Long if-elif chain mapping values can be replaced with dictionary lookup | low | ruff | SIM116 (IfElseBlockInsteadOfDictLookup) | new | python |
| code-quality/deterministic/multiple-with-statements | Multiple nested with statements | Nested with statements can be combined into a single with statement | low | ruff | SIM117 (MultipleWithStatements) | new | python |
| code-quality/deterministic/in-dict-keys | Unnecessary .keys() in membership test | Using key in dict.keys() instead of key in dict — .keys() call is redundant | low | ruff, sonar-python | SIM118 (InDictKeys), S8521 | new | python |
| code-quality/deterministic/double-negation | Double negation | Using not not x — simplify to bool(x) or just x | low | ruff, sonar-python | SIM208 (DoubleNegation), S2761 | new | python |
| code-quality/deterministic/contradictory-boolean-expression | Contradictory boolean expression | Expression like x and not x or x or not x — always False or always True | medium | ruff | SIM220 (ExprAndNotExpr), SIM221 (ExprOrNotExpr), SIM222 (ExprOrTrue), SIM223 (ExprAndFalse) | new | python |
| code-quality/deterministic/yoda-condition | Yoda condition | Constant on left side of comparison (if 0 == x) — less readable than (if x == 0) | low | ruff | SIM300 (YodaConditions) | new | python |
| code-quality/deterministic/if-else-instead-of-dict-get | if-else instead of dict.get() | if key in dict / else default pattern can be replaced with dict.get(key, default) | low | ruff | SIM401 (IfElseBlockInsteadOfDictGet) | new | python |
| code-quality/deterministic/dict-get-none-default | dict.get with None default | dict.get(key, None) — None is already the default, remove explicit None | low | ruff | SIM910 (DictGetWithNoneDefault) | new | python |
| code-quality/deterministic/typing-only-import | Runtime import used only for type checking | Import used only in type annotations should be inside TYPE_CHECKING block — reduces runtime overhead | low | ruff | TC001-TC003 (TypingOnly*Import) | new | python |
| code-quality/deterministic/empty-type-checking-block | Empty TYPE_CHECKING block | if TYPE_CHECKING block with no contents — dead code | low | ruff | TC005 (EmptyTypeCheckingBlock) | new | python |
| code-quality/deterministic/verbose-raise | Verbose re-raise | Using raise e instead of bare raise in except block — resets traceback | low | ruff | TRY201 (VerboseRaise) | new | python |
| code-quality/deterministic/useless-try-except | Useless try-except | try-except that only re-raises — serves no purpose | low | ruff | TRY203 (UselessTryExcept) | new | python |
| code-quality/deterministic/type-check-without-type-error | Type check without TypeError | Type checking logic that raises wrong exception type — should raise TypeError | low | ruff | TRY004 (TypeCheckWithoutTypeError) | new | python |
| code-quality/deterministic/try-consider-else | Logic in try body instead of else | Code in try block that should be in else clause — only guard the risky operation | low | ruff | TRY300 (TryConsiderElse) | new | python |
| code-quality/deterministic/raise-within-try | Raise within try body | Raising exception inside try block that is immediately caught — move to function | low | ruff | TRY301 (RaiseWithinTry) | new | python |
| code-quality/deterministic/error-instead-of-exception | logging.error instead of logging.exception | Using logging.error in except block instead of logging.exception — loses traceback | medium | ruff | TRY400 (ErrorInsteadOfException) | new | python |
| code-quality/deterministic/verbose-log-message | Verbose exception log message | Passing exception message to logging.exception — it already includes the exception | low | ruff | TRY401 (VerboseLogMessage) | new | python |
| code-quality/deterministic/logging-string-format | String formatting in logging call | Using .format(), f-string, %, or + in logging call instead of lazy % formatting — log message always formatted even if not emitted | low | ruff | G001-G004 (LoggingStringFormat/PercentFormat/StringConcat/FString), RUF065 (LoggingEagerConversion) | new | python |
| code-quality/deterministic/logging-extra-attr-clash | Logging extra attribute clash | logging.extra dict contains keys that clash with LogRecord attributes | medium | ruff | G101 (LoggingExtraAttrClash) | new | python |
| code-quality/deterministic/logging-redundant-exc-info | Redundant exc_info in logging | Using logging.exception() with exc_info=True — exception() already includes exc_info | low | ruff | G202 (LoggingRedundantExcInfo) | new | python |
| code-quality/deterministic/logging-direct-instantiation | Direct logger instantiation | Using logging.Logger() directly instead of logging.getLogger() — bypasses configuration | medium | ruff | LOG001 (DirectLoggerInstantiation) | new | python |
| code-quality/deterministic/logging-root-logger-call | Root logger call | Using logging.info() etc. on root logger — should use named logger via getLogger() | low | ruff | LOG015 (RootLoggerCall) | new | python |
| code-quality/deterministic/read-write-whole-file | Verbose file read/write | Using open/read/close pattern instead of Path.read_text() or Path.write_text() | low | ruff | FURB101 (ReadWholeFile), FURB103 (WriteWholeFile) | new | python |
| code-quality/deterministic/repeated-append | Repeated append calls | Multiple sequential .append() calls — use .extend() with a list instead | low | ruff | FURB113 (RepeatedAppend) | new | python |
| code-quality/deterministic/reimplemented-operator | Reimplemented operator | Lambda or function that reimplements an operator — use operator module instead | low | ruff | FURB118 (ReimplementedOperator) | new | python |
| code-quality/deterministic/readlines-in-for | readlines() in for loop | Using file.readlines() in for loop — file object is already iterable, readlines loads all into memory | low | ruff | FURB129 (ReadlinesInFor) | new | python |
| code-quality/deterministic/if-expr-min-max | if-else for min/max | Using if-else to compute minimum/maximum — use min()/max() builtin | low | ruff | FURB136 (IfExprMinMax), PLR1730 (IfStmtMinMax) | new | python |
| code-quality/deterministic/check-and-remove-from-set | Check before set.discard | Checking membership before set.remove — use set.discard() instead | low | ruff | FURB132 (CheckAndRemoveFromSet) | new | python |
| code-quality/deterministic/slice-to-remove-prefix-suffix | Slice instead of removeprefix/removesuffix | Using string slicing to remove prefix/suffix instead of str.removeprefix()/removesuffix() | low | ruff, sonar-python | FURB188 (SliceToRemovePrefixOrSuffix), S6659 | new | python |
| code-quality/deterministic/startswith-endswith-tuple | Multiple startswith/endswith calls | Multiple startswith/endswith calls that can be combined with tuple argument | low | ruff | PIE810 (MultipleStartsEndsWith) | new | python |
| code-quality/deterministic/duplicate-class-field | Duplicate class field definition | Class defines same field multiple times — last definition wins, earlier ones are dead code | medium | ruff, sonar-python | PIE794 (DuplicateClassFieldDefinition), S8512 | new | python |
| code-quality/deterministic/non-unique-enum-values | Non-unique enum values | Enum members with duplicate values — may cause unexpected behavior | medium | ruff | PIE796 (NonUniqueEnums) | new | python |
| code-quality/deterministic/unnecessary-dict-kwargs | Unnecessary dict unpacking in kwargs | Using **{"key": value} instead of key=value — unnecessarily verbose | low | ruff | PIE804 (UnnecessaryDictKwargs) | new | python |
| code-quality/deterministic/numpy-deprecated-type-alias | Deprecated NumPy type alias | Using deprecated np.int, np.float etc. — use built-in int, float or np.int64 | medium | ruff, sonar-python | NPY001 (NumpyDeprecatedTypeAlias), NPY003 (NumpyDeprecatedFunction), NPY201 (Numpy2Deprecation), S6730 | new | python |
| code-quality/deterministic/numpy-legacy-random | NumPy legacy random API | Using np.random.seed() or np.random.RandomState — use np.random.default_rng() instead | medium | ruff, sonar-python | NPY002 (NumpyLegacyRandom), S6711 | new | python |
| code-quality/deterministic/pandas-inplace-argument | Pandas inplace=True usage | Using inplace=True on DataFrame operations — creates confusing mutation, breaks method chaining | medium | ruff, sonar-python | PD002 (PandasUseOfInplaceArgument), S6734 | new | python |
| code-quality/deterministic/pandas-use-of-dot-values | Pandas .values instead of .to_numpy() | .values returns numpy array or ExtensionArray — use .to_numpy() for consistent behavior | low | ruff, sonar-python | PD011 (PandasUseOfDotValues), S6741 | new | python |
| code-quality/deterministic/pandas-merge-parameters | Pandas merge without explicit params | pd.merge or .join without explicit on, how, validate — ambiguous merge behavior | medium | ruff, sonar-python | PD015 (PandasUseOfPdMerge), S6735 | new | python |
| code-quality/deterministic/pytest-raises-multiple-statements | pytest.raises with multiple statements | Multiple statements in pytest.raises block — only last statement is tested | medium | ruff | PT012 (PytestRaisesWithMultipleStatements) | new | python |
| code-quality/deterministic/pytest-duplicate-parametrize | Duplicate parametrize test cases | pytest.mark.parametrize with duplicate test case values | medium | ruff | PT014 (PytestDuplicateParametrizeTestCases) | new | python |
| code-quality/deterministic/pytest-fail-without-message | pytest.fail without message | pytest.fail() called without a message — provide context for failure | low | ruff | PT016 (PytestFailWithoutMessage) | new | python |
| code-quality/deterministic/pytest-assert-in-except | Assert in except block | Using assert in except block — if test fails assertion, original exception is lost | medium | ruff | PT017 (PytestAssertInExcept) | new | python |
| code-quality/deterministic/pytest-composite-assertion | Composite pytest assertion | Multiple assertions combined with and/or — if one fails, cant tell which | low | ruff | PT018 (PytestCompositeAssertion) | new | python |
| code-quality/deterministic/pytest-unittest-assertion | Unittest assertion in pytest | Using self.assertEqual etc. in pytest tests — use plain assert instead | low | ruff | PT009 (PytestUnittestAssertion), PT027 (PytestUnittestRaisesAssertion) | new | python |
| code-quality/deterministic/pytest-warns-issues | pytest.warns issues | pytest.warns without warning class or with multiple statements | medium | ruff | PT029 (PytestWarnsWithoutWarning), PT030 (PytestWarnsTooBroad), PT031 | new | python |
| code-quality/deterministic/property-with-parameters | Property with parameters | Property method defined with parameters other than self — properties should not take args | high | ruff | PLR0206 (PropertyWithParameters) | new | python |
| code-quality/deterministic/too-many-locals | Too many local variables | Function has too many local variables — should be refactored into smaller functions | low | ruff | PLR0914 (TooManyLocals) | new | python |
| code-quality/deterministic/too-many-statements | Too many statements | Function has too many statements — should be broken down into smaller functions | low | ruff | PLR0915 (TooManyStatements) | new | python |
| code-quality/deterministic/too-many-boolean-expressions | Too many boolean expressions | Condition with too many boolean clauses — hard to understand | low | ruff | PLR0916 (TooManyBooleanExpressions) | new | python |
| code-quality/deterministic/too-many-nested-blocks | Too many nested blocks | Code nested too deeply in if/for/while/try blocks | medium | ruff, sonar-python | PLR1702 (TooManyNestedBlocks), S134 | new | python |
| code-quality/deterministic/too-many-public-methods | Too many public methods | Class has too many public methods — may have too many responsibilities | low | ruff | PLR0904 (TooManyPublicMethods) | new | python |
| code-quality/deterministic/comparison-of-constant | Comparison of constants | Comparing two constant values — expression result is always the same | medium | ruff | PLR0133 (ComparisonOfConstant) | new | python |
| code-quality/deterministic/sys-exit-alias | sys.exit alias | Using exit() or quit() builtins — use sys.exit() which is always available | low | ruff | PLR1722 (SysExitAlias) | new | python |
| code-quality/deterministic/unnecessary-dict-index-lookup | Unnecessary dict index lookup | Accessing dict[key] inside items() loop — value is already available | low | ruff, sonar-python | PLR1733 (UnnecessaryDictIndexLookup), S7517 | new | python |
| code-quality/deterministic/unnecessary-list-index-lookup | Unnecessary list index lookup | Accessing list[i] inside enumerate() loop — value is already available | low | ruff | PLR1736 (UnnecessaryListIndexLookup) | new | python |
| code-quality/deterministic/non-augmented-assignment | Non-augmented assignment | Using x = x + 1 instead of x += 1 | low | ruff | PLR6104 (NonAugmentedAssignment) | new | python |
| code-quality/deterministic/literal-membership-test | Membership test on literal list | Using x in [1, 2, 3] — use set literal {1, 2, 3} for O(1) lookup | low | ruff | PLR6201 (LiteralMembership) | new | python |
| code-quality/deterministic/no-self-use | Method does not use self | Method does not access instance data — should be static method or function | low | ruff, sonar-python | PLR6301 (NoSelfUse), S2325 | new | python |
| code-quality/deterministic/boolean-chained-comparison | Boolean chained comparison | Chained comparisons that can be simplified (a < b and b < c to a < b < c) | low | ruff | PLR1716 (BooleanChainedComparison) | new | python |
| code-quality/deterministic/and-or-ternary | and/or used as ternary | Using x and y or z as ternary — fails when y is falsy, use y if x else z | medium | ruff | PLR1706 (AndOrTernary) | new | python |
| code-quality/deterministic/global-variable-not-assigned | Global declaration for read-only variable | Using global keyword for variable that is only read — global is unnecessary | low | ruff | PLW0602 (GlobalVariableNotAssigned) | new | python |
| code-quality/deterministic/nested-min-max | Nested min/max calls | Nested min()/max() calls — flatten into single call with multiple arguments | low | ruff | PLW3301 (NestedMinMax) | new | python |
| code-quality/deterministic/bad-dunder-method-name | Bad dunder method name | Method name looks like a dunder but is misspelled — likely a typo | medium | ruff | PLW3201 (BadDunderMethodName) | new | python |
| code-quality/deterministic/redeclared-assigned-name | Variable redeclared in same scope | Variable name assigned and then immediately redeclared — second declaration overwrites | medium | ruff | PLW0128 (RedeclaredAssignedName) | new | python |
| code-quality/deterministic/useless-import-alias | Useless import alias | Import aliased to same name (import x as x) — alias has no effect | low | ruff | PLC0414 (UselessImportAlias) | new | python |
| code-quality/deterministic/unnecessary-dunder-call | Unnecessary dunder call | Calling dunder method directly (x.__len__()) instead of using builtin (len(x)) | low | ruff | PLC2801 (UnnecessaryDunderCall) | new | python |
| code-quality/deterministic/unnecessary-direct-lambda-call | Immediately invoked lambda | Lambda defined and immediately called — use a regular expression or function instead | low | ruff | PLC3002 (UnnecessaryDirectLambdaCall) | new | python |
| code-quality/deterministic/iteration-over-set | Iteration over set | Iterating over a set literal — order is non-deterministic, use sorted() or list | low | ruff | PLC0208 (IterationOverSet) | new | python |
| code-quality/deterministic/len-test | len() used as boolean test | Using len(x) in boolean context instead of checking truthiness directly | low | ruff | PLC1802 (LenTest) | new | python |
| code-quality/deterministic/compare-to-empty-string | Comparison to empty string | Using x == "" instead of not x or checking truthiness | low | ruff | PLC1901 (CompareToEmptyString) | new | python |
| code-quality/deterministic/missing-maxsplit-arg | Missing maxsplit in split | Using str.split()[0] without maxsplit argument — splits entire string unnecessarily | low | ruff | PLC0207 (MissingMaxsplitArg) | new | python |
| code-quality/deterministic/ambiguous-unicode-character | Ambiguous Unicode character | Visually similar Unicode character used instead of ASCII equivalent in strings or docstrings — can cause subtle bugs | medium | ruff | RUF001 (AmbiguousUnicodeCharacterString), RUF002 (AmbiguousUnicodeCharacterDocstring) | new | python |
| code-quality/deterministic/collection-literal-concatenation | Collection literal concatenation | Concatenating list/tuple literals instead of combining into single literal | low | ruff | RUF005 (CollectionLiteralConcatenation) | new | python |
| code-quality/deterministic/zip-instead-of-pairwise | zip() instead of pairwise() | Using zip(x, x[1:]) instead of itertools.pairwise() — less efficient and less clear | low | ruff | RUF007 (ZipInsteadOfPairwise) | new | python |
| code-quality/deterministic/useless-if-else | Useless if-else | if-else that returns True/False or same value in both branches — can be simplified | low | ruff | RUF034 (UselessIfElse), RUF050 (UnnecessaryIf) | new | python |
| code-quality/deterministic/unnecessary-key-check | Unnecessary key existence check | Checking key in dict before dict[key] or dict.get() — redundant check | low | ruff | RUF019 (UnnecessaryKeyCheck), RUF051 (IfKeyInDictDel) | new | python |
| code-quality/deterministic/unnecessary-regular-expression | Unnecessary regular expression | Using re.sub/re.match for simple string operations — str.replace() or str methods suffice | low | ruff | RUF055 (UnnecessaryRegularExpression) | new | python |
| code-quality/deterministic/blanket-type-ignore | Blanket type: ignore comment | Using # type: ignore without specific error code — suppresses all type errors on the line | low | ruff | PGH003 (BlanketTypeIgnore) | new | python |
| code-quality/deterministic/fastapi-non-annotated-dependency | FastAPI non-annotated dependency | FastAPI dependency declared without Annotated — should use Annotated[type, Depends(...)] | low | ruff, sonar-python | FAST002 (FastApiNonAnnotatedDependency), S8410 | new | python |
| code-quality/deterministic/django-locals-in-render | Django render with locals() | Passing locals() to Django render() — exposes all local variables to template, including sensitive data | medium | ruff, sonar-python | DJ003 (DjangoLocalsInRenderFunction), S6556 | new | python |
| code-quality/deterministic/django-unordered-body-content | Django model body not ordered | Django model class body not following recommended ordering (fields, Meta, __str__, methods) | low | ruff | DJ012 (DjangoUnorderedBodyContentInModel) | new | python |
| code-quality/deterministic/unused-private-method | Unused private method | Private class method (__method or _method) never called — dead code | low | sonar-python | S1144 | new | python |
| code-quality/deterministic/unused-private-nested-class | Unused private nested class | Private nested class never instantiated or referenced — dead code | low | sonar-python | S3985 | new | python |
| code-quality/deterministic/unread-private-attribute | Unread private attribute | Private attribute set but never read — dead code or missing usage | low | sonar-python | S4487 | new | python |
| code-quality/deterministic/unused-scope-definition | Unused scope-limited definition | Variable or function defined in local scope but never used | low | sonar-python | S5603 | new | python |
| code-quality/deterministic/exception-base-class | Custom exception inherits wrong base | Custom exception class should inherit from Exception or a subclass, not BaseException | medium | sonar-python | S5709 | new | python |
| code-quality/deterministic/return-not-implemented | Special method should return NotImplemented | Binary special methods (__eq__, __add__, etc.) should return NotImplemented instead of raising NotImplementedError | medium | sonar-python | S5712 | new | python |
| code-quality/deterministic/self-first-argument | Instance method self naming | First argument of instance method is not named self — confusing and unconventional | low | sonar-python | S5720 | new | python |
| code-quality/deterministic/confusing-type-check | Confusing type check | Type check expression that is confusing or does not work as expected | medium | sonar-python | S5864 | new | python |
| code-quality/deterministic/test-not-discoverable | Test method not discoverable | Test method name does not follow naming convention — test runner will not discover it | high | sonar-python | S5899 | new | python |
| code-quality/deterministic/unittest-specific-assertion | Use specific unittest assertion | Using assertTrue(a == b) instead of assertEqual(a, b) — less informative failure messages | low | sonar-python | S5906 | new | python |
| code-quality/deterministic/unconditional-assertion | Assertion always succeeds or fails | Assertion comparing constants or using invariant expression — useless test | medium | sonar-python | S5914 | new | python |
| code-quality/deterministic/test-skipped-implicitly | Test skipped implicitly | Test not running due to wrong name or decoration — should use skip decorator explicitly | medium | sonar-python | S5918 | new | python |
| code-quality/deterministic/regex-char-class-preferred | Regex char class preferred over quantifier | Using reluctant quantifier when character class would be more efficient and clearer | low | sonar-python | S5857 | new | python |
| code-quality/deterministic/regex-unnecessary-non-capturing-group | Unnecessary non-capturing group | Non-capturing group (?:...) without quantifier or alternation — grouping serves no purpose | low | sonar-python | S6395 | new | python |
| code-quality/deterministic/regex-superfluous-quantifier | Superfluous regex quantifier | Regex quantifier like {1} that has no effect — can be removed | low | sonar-python | S6396 | new | python |
| code-quality/deterministic/regex-octal-escape | Octal escape in regex | Using octal escape sequences in regular expressions — confusing and error-prone | low | sonar-python | S6537 | new | python |
| code-quality/deterministic/missing-type-hints | Missing function type hints | Function parameters or return type without type hints — reduces type safety and IDE support | low | ruff, sonar-python | ANN001-ANN206, S6538, S6540 | new | python |
| code-quality/deterministic/generic-type-unparameterized | Generic type without parameters | Using List, Dict, Optional without type parameters — incomplete type information | low | sonar-python | S6543 | new | python |
| code-quality/deterministic/legacy-type-hint-syntax | Legacy type hint syntax | Using typing.List/Dict/Union instead of built-in list/dict/X|Y syntax (Python 3.9+/3.10+) | low | ruff, sonar-python | UP006 (NonPEP585Annotation), UP007 (NonPEP604AnnotationUnion), S6545, S6546 | new | python |
| code-quality/deterministic/legacy-generic-syntax | Legacy generic class/function syntax | Using TypeVar instead of PEP 695 type parameter syntax (Python 3.12+) | low | ruff, sonar-python | UP040 (NonPEP695TypeAlias), UP046/UP047, S6792, S6794, S6796 | new | python |
| code-quality/deterministic/deeply-nested-fstring | Deeply nested f-string | f-strings nested too deeply — hard to read and maintain | low | sonar-python | S6799 | new | python |
| code-quality/deterministic/numpy-reproducible-random | Non-reproducible random results | Random number generation without seed — results not reproducible for scientific computing | medium | sonar-python | S6709 | new | python |
| code-quality/deterministic/numpy-list-to-array | Generator passed to np.array | Passing generator to np.array — pass a list instead for correct behavior | medium | sonar-python | S6714 | new | python |
| code-quality/deterministic/numpy-nonzero-preferred | np.where without condition alternatives | Using np.where with only condition parameter — use np.nonzero instead | low | sonar-python | S6729 | new | python |
| code-quality/deterministic/pandas-read-csv-dtype | pandas.read_csv without dtype | Reading CSV without dtype parameter — pandas infers types which may be wrong | medium | sonar-python | S6740 | new | python |
| code-quality/deterministic/pandas-pipe-preferred | Pandas method chaining too long | Long chain of DataFrame operations — use pandas.pipe() for readability | low | sonar-python | S6742 | new | python |
| code-quality/deterministic/pandas-datetime-format | Pandas datetime format issue | Incorrect date format when using dayfirst or yearfirst arguments in pd.to_datetime | medium | sonar-python | S6894 | new | python |
| code-quality/deterministic/pytz-deprecated | pytz usage in Python 3.9+ | Using pytz library when zoneinfo module is available — pytz has known edge cases | low | sonar-python | S6890 | new | python |
| code-quality/deterministic/tf-function-recursive | Recursive tf.function | tensorflow.function should not be recursive — causes retracing on each call | medium | sonar-python | S6908 | new | python |
| code-quality/deterministic/tf-function-global-variable | tf.function depends on global variable | tf.function should not depend on global or free Python variables — causes unexpected behavior | medium | sonar-python | S6911 | new | python |
| code-quality/deterministic/tf-variable-singleton | tf.Variable not singleton in tf.function | tf.Variable objects should be singletons when created inside tf.function — multiple creation is inefficient | medium | sonar-python | S6918 | new | python |
| code-quality/deterministic/tf-keras-input-shape | tf.keras.Model subclass input_shape | input_shape parameter should not be specified for tf.keras.Model subclasses — causes error | medium | sonar-python | S6919 | new | python |
| code-quality/deterministic/tf-gather-validate-indices | tf.gather validate_indices deprecated | validate_indices argument deprecated for tf.gather — should not be set | low | sonar-python | S6925 | new | python |
| code-quality/deterministic/sklearn-pipeline-memory | Scikit-Learn Pipeline without memory | Pipeline without memory parameter — repeated fits recompute all transformers | low | sonar-python | S6969 | new | python |
| code-quality/deterministic/ml-missing-hyperparameters | Missing ML hyperparameters | Important hyperparameters not specified for estimators/optimizers — relying on defaults may not be optimal | medium | sonar-python | S6973 | new | python |
| code-quality/deterministic/torch-autograd-variable | torch.autograd.Variable deprecated | Using deprecated torch.autograd.Variable — use torch.tensor instead | medium | sonar-python | S6979 | new | python |
| code-quality/deterministic/torch-model-eval-train | Missing model.eval/train after load | model.eval() or model.train() should be called after loading state — model may be in wrong mode | medium | sonar-python | S6982 | new | python |
| code-quality/deterministic/lambda-init-resources | Lambda resources not initialized at construction | Reusable resources should be initialized at construction time, not per invocation | medium | sonar-python | S6243 | new | python |
| code-quality/deterministic/lambda-sync-invocation | Lambda synchronously invoking Lambda | Lambdas should not invoke other lambdas synchronously — use async patterns or Step Functions | medium | sonar-python | S6246 | new | python |
| code-quality/deterministic/aws-hardcoded-region | Hardcoded AWS region | AWS region set with hardcoded string — should use configuration or environment variable | low | sonar-python | S6262 | new | python |
| code-quality/deterministic/lambda-async-handler | Async Lambda handler | AWS Lambda handlers must not be async functions — Lambda runtime does not support async handlers | high | sonar-python | S7614 | new | python |
| code-quality/deterministic/lambda-reserved-env-var | Lambda reserved environment variable | Overriding reserved AWS Lambda environment variable names — may cause unexpected behavior | medium | sonar-python | S7617 | new | python |
| code-quality/deterministic/boto3-client-error | Uncaught botocore ClientError | botocore.exceptions.ClientError should be explicitly caught and handled — generic except hides AWS errors | medium | sonar-python | S7619 | new | python |
| code-quality/deterministic/aws-custom-polling | Custom polling instead of AWS waiters | Using custom polling loop instead of AWS waiters — waiters handle retries and timeouts properly | low | sonar-python | S7621 | new | python |
| code-quality/deterministic/boto3-pagination | boto3 missing pagination | boto3 list/describe operations without paginator — may miss results beyond first page | medium | sonar-python | S7622 | new | python |
| code-quality/deterministic/aws-cloudwatch-namespace | AWS CloudWatch custom namespace prefix | CloudWatch metrics namespace should not begin with AWS/ — reserved for AWS services | low | sonar-python | S7609 | new | python |
| code-quality/deterministic/pydantic-optional-default | Optional Pydantic field without default | Optional Pydantic field should have explicit default value — behavior varies between Pydantic v1/v2 | medium | sonar-python | S8396 | new | python |
| code-quality/deterministic/fastapi-import-string | FastAPI app not as import string | FastAPI applications should be passed as import strings when using reload/debug/workers | medium | sonar-python | S8397 | new | python |
| code-quality/deterministic/fastapi-testclient-content | TestClient wrong content parameter | TestClient requests should use content parameter for bytes or text, not data | medium | sonar-python | S8405 | new | python |
| code-quality/deterministic/fastapi-generic-route-decorator | FastAPI generic route decorator | Using @app.api_route() instead of specific @app.get(), @app.post() — less clear | low | sonar-python | S8412 | new | python |
| code-quality/deterministic/fastapi-router-prefix | Router prefix not at initialization | APIRouter prefix should be defined during initialization, not when including | low | sonar-python | S8413 | new | python |
| code-quality/deterministic/fastapi-undocumented-exception | Undocumented HTTPException | HTTPException responses should be documented in endpoint responses metadata — helps OpenAPI spec | low | sonar-python | S8415 | new | python |
| code-quality/deterministic/flask-rest-verb-annotation | Flask REST action without verb | Flask REST API actions should be annotated with specific HTTP verb (@app.get, @app.post) | low | sonar-python | S6965 | new | python |
| code-quality/deterministic/sorted-reversed-redundant | Sorted passed to reversed | sorted() result passed to reversed() — use reverse=True parameter instead | low | ruff, sonar-python | S7510, S7511, S7516 | new | python |
| code-quality/deterministic/redundant-collection-function | Redundant collection function call | Unnecessary wrapping of collections (list(sorted()), set(sorted()), etc.) | low | sonar-python | S7508 | new | python |
| code-quality/deterministic/dict-fromkeys-for-constant | Use dict.fromkeys for constant values | Populating a dict with constant values in a loop — use dict.fromkeys() instead | low | sonar-python | S7519 | new | python |
| code-quality/deterministic/unnecessary-list-in-iteration | Unnecessary list() in iteration | Wrapping iterable in list() when just iterating — creates unnecessary copy | low | sonar-python | S7504 | new | python |
| code-quality/deterministic/field-duplicates-class-name | Field duplicates containing class name | A class field has the same name as its containing class — confusing | low | sonar-python | S1700 | new | python |
| code-quality/deterministic/compression-namespace-import | Legacy compression module import | Compression modules should be imported from the compression namespace (Python 3.14+) | low | sonar-python | S7941 | new | python |
| code-quality/deterministic/template-string-pattern-matching | Template string without pattern matching | Template string processing should use structural pattern matching for cleaner code | low | sonar-python | S7945 | new | python |
| code-quality/deterministic/prefer-pathlib | Prefer pathlib over os.path | Use pathlib.Path methods instead of os.path, os, glob, and builtin open() for file system operations. Covers os.path.*, os.mkdir/rename/remove/chmod/stat/getcwd/listdir/symlink/readlink, glob.glob, builtin open(), and py.path.local | low | ruff | PTH100-PTH209, PTH211, PTH201, FURB177 | new | python |
| code-quality/deterministic/missing-init-py | Missing __init__.py | Directory is missing __init__.py — implicit namespace package may cause import issues with some tools | medium | ruff | INP001 (ImplicitNamespacePackage) | new | python |
| code-quality/deterministic/pytest-suboptimal-pattern | Suboptimal pytest pattern | pytest.mark.parametrize values should be list of tuples, use return_value over lambda in patches, import from pytest not py.test, deprecated yield_fixture, use yield over request.addfinalizer, useless yield fixture, unnecessary asyncio mark on fixture | low | ruff | PT007, PT008, PT013, PT020, PT021, PT022, PT024 | new | python |
| code-quality/deterministic/python-idiom-simplification | Python idiom simplification | Use simpler Python idioms: x or default instead of ternary, .clear() instead of del x[:], .copy() instead of x[:], direct iteration instead of unnecessary enumerate, == instead of single-item membership test, reversed() instead of slice reverse copy | low | ruff | FURB110, FURB131, FURB145, FURB148, FURB171, FURB187 | new | python |
| code-quality/deterministic/use-bit-count | Use int.bit_count | Use int.bit_count() instead of bin(x).count("1") — cleaner and faster (Python 3.10+) | low | ruff | FURB161 (BitCount) | new | python |
| code-quality/deterministic/subclass-builtin-collection | Subclass UserDict/UserList instead of dict/list | Subclass collections.UserDict/UserList instead of dict/list directly — builtin subclasses have surprising behavior with overridden methods | medium | ruff | FURB189 (SubclassBuiltin) | new | python |
| code-quality/deterministic/unnecessary-empty-iterable-in-deque | Unnecessary empty iterable in deque | Unnecessary empty iterable argument in deque() constructor — deque() with no args is equivalent | low | ruff | RUF037 (UnnecessaryEmptyIterableWithinDequeCall) | new | python |
| code-quality/deterministic/airflow-3-migration | Airflow 3 migration required | APIs removed, moved to provider packages, or with incompatible signatures in Airflow 3 — migration required | medium | ruff | AIR301, AIR302, AIR311, AIR312, AIR321 | new | python |
| code-quality/deterministic/import-outside-top-level | Import outside top level | Import statement inside function or conditional block instead of at module top level — impacts code clarity and may mask import errors | low | ruff | PLC0415 (ImportOutsideTopLevel) | new | python |
| code-quality/deterministic/use-decorator-syntax | Use decorator syntax | Using classmethod()/staticmethod() function call instead of @classmethod/@staticmethod decorator syntax | low | ruff | PLR0202 (NoClassmethodDecorator), PLR0203 (NoStaticmethodDecorator) | new | python |
| code-quality/deterministic/manual-from-import | Manual from-import | `import x.y; x.y.z` instead of `from x.y import z` — unnecessarily verbose | low | ruff | PLR0402 (ManualFromImport) | new | python |
| code-quality/deterministic/too-many-positional-arguments | Too many positional arguments | Function has too many positional-only arguments — should use keyword args or dataclass | medium | ruff | PLR0917 (TooManyPositionalArguments) | new | python |
| code-quality/deterministic/swap-variables-pythonic | Non-pythonic variable swap | Using temporary variable for swap instead of `a, b = b, a` tuple unpacking | low | ruff | PLR1712 (SwapWithTemporaryVariable) | new | python |
| code-quality/deterministic/banned-api-import | Banned API import | Configurable banned API imports, relative imports, banned module-level imports, and lazy import mismatches — project-specific rules to enforce import policies | low | ruff | TID251 (BannedApi), TID252 (RelativeImports), TID253 (BannedModuleLevelImports), TID254 (LazyImportMismatch) | new | python |
| code-quality/deterministic/unnecessary-assign-before-return | Unnecessary assignment before return/yield | Variable assigned only to be immediately returned or yielded — can return/yield expression directly | low | ruff | RET504 (UnnecessaryAssign), RUF070 (UnnecessaryAssignBeforeYield) | new | python |
| code-quality/deterministic/future-annotations-import | Future annotations import needed | Type annotation requires or benefits from `from __future__ import annotations` to enable PEP 604 syntax on older Python | low | ruff | FA100 (FutureRewritableTypeAnnotation), FA102 (FutureRequiredTypeAnnotation) | new | python |
| code-quality/deterministic/negated-comparison | Negated comparison operator | `not (a == b)` instead of `a != b` or `not (a != b)` instead of `a == b` — unnecessarily complex | low | ruff | SIM201 (NegateEqualOp), SIM202 (NegateNotEqualOp) | new | python |
| code-quality/deterministic/split-static-string | Split on static string | `"a,b,c".split(",")` on a static string — result is known at write time, use a list literal | low | ruff | SIM905 (SplitStaticString) | new | python |
| code-quality/deterministic/zip-dict-keys-values | Zip dict keys and values | `zip(d.keys(), d.values())` instead of `d.items()` — unnecessarily verbose | low | ruff | SIM911 (ZipDictKeysAndValues) | new | python |
| code-quality/deterministic/pyupgrade-modernization | Python syntax modernization | Modernize Python syntax: isinstance() over type(), super() without args, @lru_cache without parens, unnecessary .encode("utf-8"), class syntax for TypedDict/NamedTuple, redundant open modes, datetime.UTC, native literals, typing.Text alias, io.open alias, universal_newlines→text, capture_output, unnecessary unpacked comprehension, yield from, format literals, printf formatting, @cache over @lru_cache(maxsize=None), outdated version blocks, unnecessary quoted annotations, StrEnum, unnecessary default type args, PEP 646 unpack, private type parameters | low | ruff | UP003, UP008, UP011-UP022, UP027-UP031, UP033, UP036, UP037, UP042-UP044, UP049 | new | python |
| code-quality/deterministic/pandas-accessor-preference | Pandas accessor style preference | pandas-vet preferences for accessor methods: .loc over .at, .iloc over .iat, .pivot_table over .pivot/.unstack, .read_csv over .read_table, .melt over .stack | low | ruff | PD008-PD010, PD012, PD013 | new | python |
| code-quality/deterministic/type-stub-style | Type stub style | .pyi stub file conventions: use `...` instead of pass, no implementations in stubs, typed arguments should use `...` defaults, no complex assignments, unused private TypeVars/Protocols/TypeAliases/TypedDicts, use Self type, no quoted annotations, use typing.NamedTuple, annotate type aliases with TypeAlias, no __str__/__repr__ in stubs, no type comments, redundant numeric/literal unions, no future annotations, no multiple statements, no long string/numeric literals, use PEP 570 `/` syntax, no redundant Final[Literal], no docstrings in stubs, ByteString deprecation | low | ruff | PYI002, PYI009-PYI015, PYI017-PYI021, PYI024, PYI026, PYI029, PYI033, PYI041, PYI044, PYI046-PYI049, PYI051-PYI054, PYI057, PYI061, PYI063, PYI064 | new | python |
| code-quality/deterministic/isinstance-type-none | isinstance with type(None) | `isinstance(x, type(None))` or `type(x) is type(None)` should be `x is None` — more idiomatic and faster | low | ruff | FURB168 (IsinstanceTypeNone), FURB169 (TypeNoneComparison) | new | python |
| code-quality/deterministic/raise-vanilla-args | Long message in exception constructor | Long message passed directly to exception — should define custom exception class for reusable error messages | low | ruff | TRY003 (RaiseVanillaArgs) | new | python |
| code-quality/deterministic/needless-else | Needless else clause | Else clause after branch that always returns/breaks/continues/raises — unnecessary nesting | low | ruff | RUF047 (NeedlessElse) | new | python |
| code-quality/deterministic/non-empty-init-module | Non-empty __init__.py | __init__.py contains code beyond imports — package init files should be minimal to avoid side effects on import | low | ruff | RUF067 (NonEmptyInitModule) | new | python |
| code-quality/deterministic/symbol-description | Symbol without description | Symbol() created without description string — makes debugging harder | low | eslint | symbol-description | new | js/ts |
| code-quality/deterministic/import-formatting | Import statement formatting | One import per line, imports at top of file — consistent import formatting | low | ruff | E401 (MultipleImportsOnOneLine), E402 (ModuleImportNotAtTopOfFile) | new | python |
| code-quality/deterministic/implicit-string-concatenation | Implicit string concatenation | Adjacent string literals implicitly concatenated on single or multiple lines — may be unintentional; prefer explicit concatenation | low | ruff | ISC001 (SingleLineImplicitStringConcatenation), ISC002 (MultiLineImplicitStringConcatenation), ISC003 (ExplicitStringConcatenation) | new | python |
| code-quality/deterministic/unnecessary-parentheses-style | Unnecessary parentheses | Extraneous parentheses around expressions, class definitions, raise statements, pytest decorators — remove for cleaner syntax | low | ruff, sonar-python | UP034, UP039, RSE102, S1110, PT001, PT023 | new | python |
| code-quality/deterministic/whitespace-formatting | Whitespace formatting issues | Trailing whitespace, empty comments, indented form-feed characters, statements on same line, inline comment placement | low | ruff, sonar-python | S1131, PLR2044, RUF054, OneStatementPerLine, S139 | new | python |
| code-quality/deterministic/comment-tag-formatting | Comment tag formatting | TODO/FIXME tag format: correct capitalization, colon usage, missing author/link/description, space after colon; capitalized comments; no inline comments | low | ruff, eslint | TD001-TD007, capitalized-comments, no-inline-comments | new | all |
| code-quality/deterministic/pytest-decorator-style | Pytest decorator formatting | pytest.fixture positional args style, extraneous scope="function", parametrize names type preference | low | ruff | PT002, PT003, PT006 | new | python |
| code-quality/deterministic/js-style-preference | JavaScript style preferences | Arrow function body braces, function declaration vs expression, curly braces for control flow, variable declaration grouping, vars-on-top, object shorthand, operator assignment shorthand, arrow callbacks, exponentiation operator, numeric literals, logical assignment, increment/decrement operators, continue statements, ternary usage, multiline strings, variable initialization, strict mode, yoda conditions, arrow function convention, call argument line breaks | low | eslint, sonarjs | arrow-body-style, func-style, curly, one-var, vars-on-top, object-shorthand, operator-assignment, prefer-arrow-callback, prefer-exponentiation-operator, prefer-numeric-literals, logical-assignment-operators, no-plusplus, no-continue, no-ternary, no-multi-str, init-declarations, strict, yoda, S3524, S1472 | new | js/ts |
| code-quality/deterministic/ts-declaration-style | TypeScript declaration style | Overload signature adjacency, array type syntax, class literal property style, generic constructor placement, indexed object style, type assertion syntax, interface vs type, member ordering, method signature syntax, parameter properties, namespace keyword, member accessibility | low | @typescript-eslint | adjacent-overload-signatures, array-type, class-literal-property-style, consistent-generic-constructors, consistent-indexed-object-style, consistent-type-assertions, consistent-type-definitions, member-ordering, method-signature-style, parameter-properties, prefer-namespace-keyword, explicit-member-accessibility | new | js/ts |
| code-quality/deterministic/sorting-style | Sorting/ordering preferences | Sorted imports, sorted object keys, sorted variables, sorted __all__ entries, sorted __slots__ entries | low | eslint, ruff | sort-imports, sort-keys, sort-vars, RUF022, RUF023 | new | all |
| code-quality/deterministic/python-minor-style-preference | Python minor style preferences | Ambiguous Unicode in comments, parenthesized chained operators, tuple subscript parenthesization, None ordering in unions, f-string percent format, number base format preference, math constant usage, repeated global statements, hardcoded string charset constants, verbose Decimal constructor, fromisoformat Z replacement, redundant log base, unnecessary from_float, int on sliced hex string, regex flag alias, hashlib digest hex style | low | ruff | RUF003, RUF021, RUF031, RUF036, RUF073, FURB116, FURB152, FURB154, FURB156, FURB157, FURB162, FURB163, FURB164, FURB166, FURB167, FURB181 | new | python |
| code-quality/deterministic/python-naming-convention | Python naming conventions | TypeVar variance suffixes (_co, _contra), TypeVar bivariance, TypeVar name matching, non-ASCII identifiers, non-ASCII import names, import alias conventions (np/pd), banned import aliases/from, DataFrame variable naming (df), TypeVar underscore prefix in stubs, type alias CamelCase, type alias T-suffix; method, field, variable, function, and module naming conventions | low | ruff, sonar-python | PLC0105, PLC0131, PLC0132, PLC2401, PLC2403, ICN001-ICN003, PD901, PYI001, PYI042, PYI043, S100, S116, S117, S1542, S1578 | new | python |
| code-quality/deterministic/js-naming-convention | JavaScript/TypeScript naming conventions | camelCase enforcement, consistent this-alias naming, function name matching assignment, named function expressions, identifier deny-list, identifier length limits, identifier regex patterns, constructor PascalCase, no dangling underscores, function/variable naming conventions | low | eslint, sonarjs | camelcase, consistent-this, func-name-matching, func-names, id-denylist, id-length, id-match, new-cap, no-underscore-dangle, S100, S117 | new | js/ts |
| code-quality/deterministic/docstring-completeness | Docstring completeness | Missing or extraneous docstring content: missing/extra parameter docs, missing/extra return docs, missing/extra yield docs, missing/extra exception docs, missing docstring definition | low | ruff, sonar-python | DOC102, DOC201, DOC202, DOC402, DOC403, DOC501, DOC502, S1720 | new | python |
| code-quality/deterministic/unused-annotation | Unused variable annotation | Local variable annotated with type but never assigned a value — dead annotation | low | ruff | F842 (UnusedAnnotation) | new | python |
| code-quality/deterministic/pprint-usage | pprint call in production code | Using `pprint()` instead of proper logging or serialization — debug-only function | low | ruff | T203 (PPrint) | new | python |
| code-quality/deterministic/pandas-deprecated-accessor | Deprecated pandas accessor | Using `.isnull()` instead of `.isna()`, `.notnull()` instead of `.notna()`, `.ix` instead of `.loc/.iloc` — deprecated API | low | ruff | PD003 (PandasUseOfDotIsNull), PD004 (PandasUseOfDotNotNull), PD007 (PandasUseOfDotIx) | new | python |
| code-quality/deterministic/duplicate-union-literal-member | Duplicate member in union or Literal type | Union type or `Literal` type annotation with duplicate members — redundant and confusing | low | ruff | PYI016 (DuplicateUnionMember), PYI062 (DuplicateLiteralMember), RUF041 (UnnecessaryNestedLiteral) | new | python |
| code-quality/deterministic/unnecessary-type-union | Unnecessary `type[X] \| type[Y]` union | `type[X] \| type[Y]` should be written as `type[X \| Y]` — simpler type expression | low | ruff | PYI055 (UnnecessaryTypeUnion) | new | python |
| code-quality/deterministic/type-checking-alias-annotation | Type alias quoting issues | Type alias should or should not use string annotation depending on runtime vs type-checking context — inconsistent quoting causes errors | low | ruff | TC007 (UnquotedTypeAlias), TC008 (QuotedTypeAlias), TC010 (RuntimeStringUnion) | new | python |
| code-quality/deterministic/unnecessary-placeholder-statement | Unnecessary pass or ellipsis placeholder | `pass` or `...` in block that already has a body — redundant placeholder statement | low | ruff | PIE790 (UnnecessaryPlaceholder) | new | python |
| code-quality/deterministic/unnecessary-dict-spread | Unnecessary dict spread | `{**d}` when `d.copy()` suffices — unnecessary unpacking | low | ruff | PIE800 (UnnecessarySpread) | new | python |
| code-quality/deterministic/reimplemented-container-builtin | Lambda reimplements container builtin | Lambda that reimplements `list`, `dict`, `tuple` etc. — use the builtin directly | low | ruff | PIE807 (ReimplementedContainerBuiltin) | new | python |
| code-quality/deterministic/unnecessary-range-start | Unnecessary range start | `range(0, n)` — `0` is the default start, can be omitted | low | ruff | PIE808 (UnnecessaryRangeStart) | new | python |
| code-quality/deterministic/logging-exc-info-instead-of-exception | logging.error with exc_info instead of logging.exception | `logging.error(..., exc_info=True)` should use `logging.exception()` instead — more idiomatic | low | ruff | G201 (LoggingExcInfo) | new | python |
| code-quality/deterministic/static-join-to-fstring | Static string join to f-string | `"".join()` on static strings can be replaced with an f-string or string concatenation | low | ruff | FLY002 (StaticJoinToFString) | new | python |
| code-quality/deterministic/print-empty-string | print("") instead of print() | Passing empty string to `print()` — `print()` with no args produces same output | low | ruff | FURB105 (PrintEmptyString) | new | python |
| code-quality/deterministic/metaclass-abcmeta | Use ABC instead of metaclass=ABCMeta | Using `metaclass=ABCMeta` instead of inheriting from `ABC` — less readable | low | ruff | FURB180 (MetaClassABCMeta) | new | python |
| code-quality/deterministic/explicit-fstring-conversion | Missing explicit f-string type conversion | f-string should use explicit `!s`, `!r`, or `!a` conversion flags instead of calling `str()`, `repr()`, or `ascii()` | low | ruff | RUF010 (ExplicitFStringTypeConversion) | new | python |
| code-quality/deterministic/unnecessary-cast-to-int | Unnecessary int() cast | `int()` called on value that is already an integer — redundant conversion | low | ruff | RUF046 (UnnecessaryCastToInt) | new | python |
| code-quality/deterministic/map-int-version-parsing | Version string parsing with map(int) | `map(int, version.split("."))` — fragile version parsing, use `sys.version_info` or packaging library | low | ruff | RUF048 (MapIntVersionParsing) | new | python |
| code-quality/deterministic/unnecessary-round | Unnecessary round() call | `round()` called on integer value — has no effect | low | ruff | RUF057 (UnnecessaryRound) | new | python |
| code-quality/deterministic/starmap-zip-simplification | starmap(f, zip(a,b)) simplification | `itertools.starmap(f, zip(a, b))` can be simplified to `map(f, a, b)` | low | ruff | RUF058 (StarmapZip) | new | python |
| code-quality/deterministic/unused-unpacked-variable | Unused unpacked variable | Variable from tuple/list unpacking that is never used — use `_` prefix | low | ruff | RUF059 (UnusedUnpackedVariable) | new | python |
| code-quality/deterministic/django-receiver-decorator-order | Django @receiver not outermost | `@receiver` decorator should be outermost decorator — inner position causes signal handler to silently fail | high | ruff | DJ013 (DjangoNonLeadingReceiverDecorator) | new | python |
| code-quality/deterministic/default-case-in-switch | Missing default case in switch | Switch statement without `default` case — may miss handling unexpected values | low | eslint | default-case | new | js/ts |
| code-quality/deterministic/dot-notation-enforcement | Dot notation enforcement | Accessing properties via bracket notation `obj["prop"]` when dot notation `obj.prop` is available — less readable | low | eslint | dot-notation | new | js/ts |
| code-quality/deterministic/max-nesting-depth | Maximum nesting depth (JS) | Blocks nested too deeply — separate from deeply-nested-logic which uses SonarJS S134 | low | eslint | max-depth | new | js/ts |
| code-quality/deterministic/max-statements-per-function | Maximum statements per function (JS) | Function has too many statements — separate from long-method which uses line count | low | eslint | max-statements | new | js/ts |
| code-quality/deterministic/unnecessary-label | Unnecessary or unused label | Labels that are unnecessary or never referenced — dead code | low | eslint | no-extra-label, no-unused-labels | new | js/ts |
| code-quality/deterministic/implicit-global-declaration | Implicit global scope declaration | Declarations in global scope using `var` or `function` — pollutes global namespace | medium | eslint | no-implicit-globals | new | js/ts |
| code-quality/deterministic/restricted-api-usage | Restricted API usage (JS) | Configurable project-specific restrictions: disallowed exports, globals, imports, properties, or syntax patterns — enforce project policies and prevent use of problematic APIs | low | eslint | no-restricted-exports, no-restricted-globals, no-restricted-imports, no-restricted-properties, no-restricted-syntax | new | js/ts |
| code-quality/deterministic/undef-init | Initializing to undefined | Explicitly initializing variables to `undefined` — unnecessary since `let x` is already undefined | low | eslint | no-undef-init | new | js/ts |
| code-quality/deterministic/undefined-as-identifier | Using undefined as identifier | Using `undefined` as an identifier name — confusing and shadows the actual undefined value | medium | eslint | no-undefined | new | js/ts |
| code-quality/deterministic/require-unicode-regexp | Missing unicode flag on RegExp | RegExp should use `u` or `v` flag — ensures correct Unicode character handling | low | eslint | require-unicode-regexp | new | js/ts |
| code-quality/deterministic/inferrable-types | Inferrable type annotations | Explicit type declaration on variable initialized to number, string, or boolean — type is obvious from initializer | low | @typescript-eslint | no-inferrable-types | new | js/ts |
| code-quality/deterministic/restricted-types | Restricted types (TypeScript) | Configurable restriction of certain TypeScript types — project-specific policy enforcement | low | @typescript-eslint | no-restricted-types | new | js/ts |
| code-quality/deterministic/required-type-annotations | Required type annotations | Requiring type annotations in places where TypeScript cannot infer types — enforces explicit typing policy | low | @typescript-eslint | typedef | new | js/ts |

### Code Quality / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/llm/environment-specific-branch | Environment-specific conditional logic | Code branching on environment name (if prod/staging/dev) in application logic — use configuration instead | medium | truecourse | - | new | all |
| code-quality/llm/missing-feature-flag | Feature deployed without feature flag | New feature shipped without feature flag — no way to disable without rollback | low | truecourse | - | new | all |
| code-quality/llm/inconsistent-config-pattern | Inconsistent configuration patterns | Some config via env vars, some via config files, some hardcoded — should be unified | low | truecourse | - | new | all |
| code-quality/llm/tautological-test | Tautological test (always passes) | Test asserts on mocked return value or static data — tests the mock, not the code | medium | truecourse | - | new | all |
| code-quality/llm/excessive-mocking | Test with excessive mocking | Test mocks so many dependencies that it tests nothing real — change in implementation won't break test | medium | truecourse | - | new | all |
| code-quality/llm/missing-edge-case-tests | Missing edge case test coverage | Tests only cover happy path — no tests for empty input, null, boundary values, error cases | medium | truecourse | - | new | all |
| code-quality/llm/test-implementation-coupling | Test coupled to implementation details | Test asserts on internal implementation (private methods, internal state) rather than behavior — breaks on refactor | medium | truecourse | - | new | all |
| code-quality/llm/missing-integration-test | Missing integration test for critical path | Critical user-facing flow only tested with unit tests, no integration/e2e test | medium | truecourse | - | new | all |
| code-quality/llm/non-deterministic-test | Non-deterministic test | Test depends on current time, random values, or external service without mocking — intermittent failure | high | truecourse | - | new | all |
| code-quality/llm/unnecessary-dependency | Unnecessary third-party dependency | Package used for trivial functionality easily implemented in a few lines — unnecessary supply chain risk | low | truecourse | - | new | all |
| code-quality/llm/abandoned-dependency | Dependency appears unmaintained | Package with no updates in 2+ years, many open issues, or deprecated notices — should find alternative | medium | truecourse | - | new | all |
| code-quality/llm/overlapping-dependencies | Multiple packages for same purpose | Two or more packages providing same functionality (moment + dayjs, lodash + ramda) — pick one | low | truecourse | - | new | all |

### Code Quality / Deterministic (TypeScript-specific)

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/deterministic/mixed-type-imports | Mixed type imports | Mixing runtime imports with type-only imports — causes unnecessary bundled code | low | @typescript-eslint | consistent-type-imports | new | js/ts |
| code-quality/deterministic/mixed-type-exports | Mixed type exports | Mixing runtime exports with type-only exports | low | @typescript-eslint | consistent-type-exports | new | js/ts |
| code-quality/deterministic/missing-return-type | Missing return type | Functions without explicit return types — weakens type safety at API boundaries | low | @typescript-eslint | explicit-function-return-type | new | js/ts |
| code-quality/deterministic/missing-boundary-types | Missing boundary types | Exported functions without explicit return/param types — public API type safety | low | @typescript-eslint | explicit-module-boundary-types | new | js/ts |
| code-quality/deterministic/unnecessary-type-conversion | Unnecessary type conversion | Type conversion that doesn't change the type (e.g., String(alreadyAString)) | low | @typescript-eslint | no-unnecessary-type-conversion | new | js/ts |
| code-quality/deterministic/unnecessary-type-parameter | Unnecessary type parameter | Generic type parameter that appears only once — unnecessary complexity | low | @typescript-eslint | no-unnecessary-type-parameters | new | js/ts |
| code-quality/deterministic/useless-default-assignment | Useless default assignment | Default assignment to constructor property that is unnecessary | low | @typescript-eslint | no-useless-default-assignment | new | js/ts |
| code-quality/deterministic/prefer-this-return-type | Prefer this return type | Method returning class name when it should return this for subclass chaining | low | @typescript-eslint | prefer-return-this-type | new | js/ts |
| code-quality/deterministic/reduce-type-cast | Reduce type cast | Using type cast with Array.reduce instead of type parameter | low | @typescript-eslint | prefer-reduce-type-parameter | new | js/ts |
| code-quality/deterministic/unnecessary-parameter-property-assignment | Unnecessary parameter property assignment | Assigning to constructor parameter property that already has the same default | low | @typescript-eslint | no-unnecessary-parameter-property-assignment | new | js/ts |
| code-quality/deterministic/unnecessary-namespace-qualifier | Unnecessary namespace qualifier | Unnecessary namespace qualifier (e.g., Enum.A inside the Enum) | low | @typescript-eslint | no-unnecessary-qualifier | new | js/ts |
| code-quality/deterministic/type-import-side-effects | Type import side effects | Type import specifiers causing side effects without top-level qualifier | low | @typescript-eslint | no-import-type-side-effects | new | js/ts |
| code-quality/deterministic/readonly-parameter-types | Readonly parameter types | Function parameters should be typed as readonly to prevent mutation | low | @typescript-eslint | prefer-readonly-parameter-types | new | js/ts |

### Code Quality / Deterministic (Testing)

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/deterministic/test-missing-assertion | Test without assertion | Test case does not include any assertions | medium | sonarjs | S2699 (assertions-in-tests) | new | js/ts |
| code-quality/deterministic/test-exclusive | Exclusive test (.only) | Test with .only() committed to version control | high | sonarjs | S6426 (no-exclusive-tests) | new | js/ts |
| code-quality/deterministic/test-skipped | Skipped test without reason | Test skipped without a documented reason | low | sonarjs | S1607 (no-skipped-tests) | new | js/ts |
| code-quality/deterministic/test-empty-file | Empty test file | Test file containing no test cases | low | sonarjs | S2187 (no-empty-test-file) | new | js/ts |
| code-quality/deterministic/test-incomplete-assertion | Incomplete assertion | Assertion that does not fully verify the expected behavior | medium | sonarjs | S2970 (no-incomplete-assertions) | new | js/ts |
| code-quality/deterministic/test-inverted-arguments | Inverted assertion arguments | Expected and actual values swapped in assertion | medium | sonarjs | S3415 (inverted-assertion-arguments) | new | js/ts |
| code-quality/deterministic/test-same-argument | Same argument in assertion | Both arguments of assertion are the same value | medium | sonarjs | S5863 (no-same-argument-assert) | new | js/ts |
| code-quality/deterministic/test-code-after-done | Code after done() callback | Test executes code after done() is called | medium | sonarjs | S6079 (no-code-after-done) | new | js/ts |
| code-quality/deterministic/test-missing-exception-check | Missing exception type check | Test does not verify which exception type is thrown | low | sonarjs | S5958 (test-check-exception) | new | js/ts |
| code-quality/deterministic/test-deterministic-assertion | Chai non-deterministic assertion | Chai assertion with more than one reason to succeed | low | sonarjs | S6092 (chai-determinate-assertion) | new | js/ts |

### Code Quality / Deterministic (React-specific)

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/deterministic/react-leaked-render | React leaked render | Non-boolean condition value rendered in JSX (0, '', NaN) | medium | sonarjs | S6439 (jsx-no-leaked-render) | new | js/ts |
| code-quality/deterministic/react-hook-setter-in-body | React hook setter in body | Calling useState setter directly in component body (infinite render) | high | sonarjs | S6442 (no-hook-setter-in-body) | new | js/ts |
| code-quality/deterministic/react-useless-set-state | React useless setState | Calling state setter with matching state variable (no-op) | medium | sonarjs | S6443 (no-useless-react-setstate) | new | js/ts |
| code-quality/deterministic/react-unstable-key | React unstable list key | JSX list component keys don't match between renders | medium | sonarjs | S6486 (no-uniq-key) | new | js/ts |
| code-quality/deterministic/react-readonly-props | React mutable props | React props should be declared as read-only | low | sonarjs | S6759 (prefer-read-only-props) | new | js/ts |

### Code Quality / Deterministic (Accessibility)

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| code-quality/deterministic/html-table-accessibility | HTML table accessibility | HTML tables should not be used for layout purposes, should have headers, header references, and `<object>` tags should provide alternative content | medium | sonarjs | S5257 (no-table-as-layout), S5264 (object-alt-content), S5256 (table-header), S5260 (table-header-reference) | new | js/ts |

---

## Database

Rules about schema issues, missing indexes, FK constraints, transactions, integrity.

### Database / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| database/deterministic/missing-transaction | Multiple related writes without transaction | Multiple INSERT/UPDATE/DELETE calls that should be atomic but are not wrapped in a transaction | high | truecourse | - | new | all |
| database/deterministic/unvalidated-external-data | External data used without validation | Data from API response, file, or message queue used directly without schema validation | high | truecourse | - | new | all |
| database/deterministic/missing-unique-constraint | Duplicate prevention via application code only | Uniqueness enforced in application code but not in database schema — race conditions can create duplicates | medium | truecourse | - | new | all |
| database/deterministic/unsafe-delete-without-where | DELETE/UPDATE without WHERE clause | SQL DELETE or UPDATE statement without WHERE condition — affects all rows in table | critical | truecourse | - | new | all |
| database/deterministic/select-star | SELECT * in production code | Fetching all columns or all records when only a subset is needed | medium | truecourse | - | new | all |
| database/deterministic/missing-migration | Schema change without migration file | Direct ALTER TABLE or schema modification not captured in migration system, including inferred schema changes outside migration system | high | truecourse | - | new | all |
| database/deterministic/connection-not-released | Database connection not released | Connection acquired from pool but not released in finally/using block — connection pool exhaustion | high | truecourse | - | new | all |
| database/deterministic/orm-lazy-load-in-loop | ORM lazy loading in loop | Accessing ORM relationship inside loop triggers individual query per iteration — N+1 pattern | high | truecourse | - | new | all |

### Database / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| database/llm/missing-foreign-key | Missing foreign key constraint | Column ending in _id without FK constraint allows orphaned records | high | truecourse-existing | llm/db-missing-foreign-key | existing | all |
| database/llm/missing-index-on-fk | Missing index on foreign key | FK or frequently queried column without index causes slow queries | medium | truecourse-existing | llm/db-missing-index | existing | all |
| database/llm/naming-inconsistency | Inconsistent naming conventions | Mixed snake_case/camelCase or singular/plural table names | low | truecourse-existing | llm/db-naming-inconsistency | existing | all |
| database/llm/missing-timestamps | Missing timestamp columns | Tables missing created_at/updated_at for audit trails | low | truecourse-existing | llm/db-missing-timestamps | existing | all |
| database/llm/overly-nullable-schema | Too many nullable columns | Table with majority of non-PK columns nullable, poor normalization | medium | truecourse-existing | llm/db-overly-nullable | existing | all |
| database/llm/inconsistent-data-validation | Validation in some paths but not others | Same data type validated in one endpoint but not another — inconsistent enforcement | high | truecourse | - | new | all |
| database/llm/missing-cascade-logic | Missing cascade on delete | Parent record deleted without handling child records — orphaned data or foreign key violation | medium | truecourse | - | new | all |
| database/llm/stale-read-after-write | Read-after-write without consistency guarantee | Writing to database then immediately reading — may get stale data with replicas or eventual consistency | medium | truecourse | - | new | all |
| database/llm/sensitive-data-unencrypted | Sensitive data stored unencrypted | PII, passwords, or secrets stored in database as plain text instead of encrypted/hashed | critical | truecourse | - | new | all |
| database/llm/missing-soft-delete | Hard delete on auditable entity | Business entity deleted permanently when soft delete (is_deleted flag) would be required for audit trail | medium | truecourse | - | new | all |
| database/llm/denormalization-without-sync | Denormalized data without sync mechanism | Data duplicated across tables without triggers, events, or application logic to keep in sync | medium | truecourse | - | new | all |
| database/llm/query-in-transaction-too-long | Long-running transaction | Transaction holding locks while doing external calls or heavy processing — blocks other operations | high | truecourse | - | new | all |

---

## Performance

Rules about runtime efficiency, memory usage, rendering, caching, and data access patterns.

### Performance / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| performance/deterministic/inline-function-in-jsx-prop | Inline function in JSX prop | Arrow function or .bind() in JSX props causes new reference every render, defeating React.memo and PureComponent | low | truecourse | - | new | js/ts |
| performance/deterministic/inline-object-in-jsx-prop | Inline object literal in JSX prop | Object literal `style={{...}}` or `options={{...}}` in JSX creates new reference every render | low | truecourse | - | new | js/ts |
| performance/deterministic/missing-cleanup-useeffect | useEffect without cleanup for subscriptions | useEffect that adds event listeners, timers, or subscriptions but returns no cleanup function | high | truecourse | - | new | js/ts |
| performance/deterministic/settimeout-setinterval-no-clear | Timer created without corresponding clear | setInterval/setTimeout assigned but never cleared — memory leak in long-running processes | medium | truecourse | - | new | js/ts |
| performance/deterministic/event-listener-no-remove | Event listener added without removal | addEventListener without corresponding removeEventListener in cleanup or destroy path | medium | truecourse | - | new | all |
| performance/deterministic/sync-fs-in-request-handler | Synchronous filesystem operation in request path | fs.readFileSync, fs.writeFileSync etc. used inside Express/Fastify/Koa route handler — blocks event loop | high | truecourse | - | new | js/ts |
| performance/deterministic/json-parse-in-loop | JSON.parse or JSON.stringify inside hot loop | Serialization/deserialization inside a loop body — expensive and often avoidable | medium | truecourse | - | new | js/ts |
| performance/deterministic/regex-in-loop | Regex compilation inside loop | `new RegExp()` inside loop body — regex should be compiled once outside the loop | low | truecourse | - | new | all |
| performance/deterministic/unbounded-array-growth | Array pushed to without bounds check | Array.push in loop or recurring callback without size limit — potential unbounded memory growth | medium | truecourse | - | new | js/ts |
| performance/deterministic/large-bundle-import | Full library import when partial available | Importing entire library (lodash, moment, date-fns) instead of specific function paths | medium | truecourse | - | new | js/ts |
| performance/deterministic/missing-usememo-expensive | Expensive computation without memoization | Array.filter/map/sort/reduce on large datasets in render body without useMemo | low | truecourse | - | new | js/ts |
| performance/deterministic/state-update-in-loop | Multiple setState calls in loop | Calling setState inside a loop instead of batching — causes multiple re-renders | medium | truecourse | - | new | js/ts |
| performance/deterministic/synchronous-crypto | Synchronous crypto operations | Using crypto.pbkdf2Sync, crypto.scryptSync etc. — blocks event loop on CPU-intensive work | medium | truecourse | - | new | js/ts |
| performance/deterministic/spread-in-reduce | Spread operator in reduce accumulator | `{...acc, [key]: value}` in reduce creates new object each iteration — O(n^2) behavior | medium | truecourse | - | new | js/ts |
| performance/deterministic/missing-react-memo | Component receiving unchanged props re-renders | Pure display component without React.memo receiving same props from parent re-render | low | truecourse | - | new | js/ts |
| performance/deterministic/unnecessary-context-provider | Context provider value changes on every render | Context value is new object/array each render — all consumers re-render every time | medium | truecourse | - | new | js/ts |
| performance/deterministic/sync-require-in-handler | Dynamic require() in request handler | require() inside request handler — synchronous file read on every request, blocks event loop | medium | truecourse | - | new | js/ts |
| performance/deterministic/quadratic-list-summation | Quadratic list concatenation | Using sum() or += to concatenate lists in loop — O(n^2) behavior, use itertools.chain or list comprehension | medium | ruff | RUF017 (QuadraticListSummation) | new | python |
| performance/deterministic/str-replace-over-re-sub | str.replace preferred over re.sub | Using re.sub for simple string replacement when str.replace suffices — slower and less readable | low | sonar-python | S5361 | new | python |
| performance/deterministic/unnecessary-iterable-allocation | Unnecessary iterable allocation for first element | Using list(x)[0] or [*x][0] instead of next(iter(x)) — allocates entire list for one element | medium | ruff | RUF015 (UnnecessaryIterableAllocationForFirstElement) | new | python |
| performance/deterministic/sorted-for-min-max | sorted() used to find min/max | Using sorted(x)[0] or sorted(x)[-1] instead of min()/max() — O(n log n) instead of O(n) | medium | sonar-python | S8517 | new | python |
| performance/deterministic/list-comprehension-in-any-all | List comprehension in any()/all() | Using any([...]) or all([...]) instead of generator expression — materializes entire list unnecessarily | low | sonar-python | S7492 | new | python |
| performance/deterministic/unnecessary-list-cast | Unnecessary list() in iteration | Wrapping iterable in list() when iterating — creates unnecessary copy in memory | low | ruff | PERF101 (UnnecessaryListCast) | new | python |
| performance/deterministic/incorrect-dict-iterator | Incorrect dict iterator method | Using dict.items() when only keys or values needed — unnecessary tuple unpacking | low | ruff, sonar-python | PERF102 (IncorrectDictIterator), S7512 | new | python |
| performance/deterministic/try-except-in-loop | Try-except in loop | Try-except block wrapping entire loop body — move try-except outside loop if exception is rare | low | ruff | PERF203 (TryExceptInLoop) | new | python |
| performance/deterministic/manual-list-comprehension | Manual list/dict comprehension | Using for loop with append/setitem when a comprehension would be faster and clearer | low | ruff | PERF401 (ManualListComprehension), PERF402 (ManualListCopy), PERF403 (ManualDictComprehension) | new | python |
| performance/deterministic/sorted-min-max-python | sorted() for min/max (Python) | Using sorted(x)[0] or sorted(x)[-1] instead of min()/max() — O(n log n) instead of O(n) | medium | ruff, sonar-python | FURB192 (SortedMinMax), S8517 | new | python |
| performance/deterministic/torch-dataloader-num-workers | DataLoader without num_workers | torch.utils.data.DataLoader without num_workers — data loading is single-threaded by default | low | sonar-python | S6983 | new | python |
| performance/deterministic/missing-slots-in-subclass | Missing __slots__ in subclass | str, tuple, or namedtuple subclass should define __slots__ for memory efficiency — prevents per-instance __dict__ creation | low | ruff | SLOT000 (NoSlotsInStrSubclass), SLOT001 (NoSlotsInTupleSubclass), SLOT002 (NoSlotsInNamedtupleSubclass) | new | python |
| performance/deterministic/batch-writes-in-loop | File writes in loop | Writing to file inside loop instead of batching — use Path.write_text/write_bytes for batch writes | low | ruff | FURB122 (ForLoopWrites) | new | python |
| performance/deterministic/set-mutations-in-loop | Set mutations in loop | Using set.add() in a for loop instead of set.update() with an iterable — slower and more verbose | low | ruff | FURB142 (ForLoopSetMutations) | new | python |
| performance/deterministic/runtime-cast-overhead | Runtime cast() overhead | typing.cast() used at runtime when it should only be used for type checking — runtime overhead for a no-op function | low | ruff | TC006 (RuntimeCastValue) | new | python |

### Performance / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| performance/llm/n-plus-one-query | N+1 query pattern | Loop fetching related data one record at a time (excluding ORM lazy-load patterns caught deterministically) | high | truecourse | - | new | all |
| performance/llm/missing-caching-opportunity | Cacheable data fetched repeatedly | Expensive or slow data fetched on every request when it changes infrequently | medium | truecourse | - | new | all |
| performance/llm/unnecessary-rerender-prop-drilling | Unnecessary re-renders from prop drilling | State passed through many component layers causing subtree re-renders when only leaf needs the data | medium | truecourse | - | new | js/ts |
| performance/llm/blocking-main-thread | CPU-intensive work on main thread | Complex computation, large data processing, or image manipulation without Web Worker or worker thread | medium | truecourse | - | new | js/ts |
| performance/llm/redundant-api-calls | Redundant API calls | Same API endpoint called multiple times in quick succession when result could be shared | medium | truecourse | - | new | all |
| performance/llm/inefficient-data-structure | Inefficient data structure choice | Using array for frequent lookups (O(n)) when Map/Set would be O(1), or vice versa | medium | truecourse | - | new | all |
| performance/llm/unoptimized-database-query | Unoptimized database query | Query using patterns known to prevent index usage (e.g., function on indexed column, OR conditions, leading wildcards) | medium | truecourse | - | new | all |
| performance/llm/missing-pagination | Missing pagination on large dataset query | Database query without LIMIT/OFFSET on potentially large table (excluding API endpoints caught by architecture rules) | high | truecourse | - | new | all |

---

## Reliability

Rules about error handling, resilience, fault tolerance, and system stability.

### Reliability / Deterministic

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| reliability/deterministic/catch-without-error-type | Catch-all exception handler | Catching generic Error/Exception without filtering by type — may hide unrelated bugs | medium | truecourse | - | new | all |
| reliability/deterministic/promise-all-no-error-handling | Promise.all without individual error handling | Promise.all fails fast on first rejection — use Promise.allSettled or add per-promise catch if partial success is acceptable | medium | truecourse | - | new | js/ts |
| reliability/deterministic/missing-finally-cleanup | Missing finally block for resource cleanup | Resource acquisition (file handle, connection, lock) without finally block or using pattern to ensure release | medium | truecourse | - | new | all |
| reliability/deterministic/unchecked-optional-chain-depth | Deep optional chaining without fallback | `a?.b?.c?.d?.e` chains suggest unstable data shape — likely missing validation at boundary | low | truecourse | - | new | js/ts |
| reliability/deterministic/unsafe-json-parse | JSON.parse without try-catch | JSON.parse on external/user input without try-catch — throws on malformed JSON | high | truecourse | - | new | js/ts |
| reliability/deterministic/http-call-no-timeout | HTTP/fetch call without timeout | External HTTP request (fetch, axios, got, requests/urllib) without timeout configuration — can hang indefinitely | high | truecourse, ruff, sonar-python | -, S113 (RequestWithoutTimeout), S7618 | new | all |
| reliability/deterministic/missing-error-event-handler | Missing error event handler | EventEmitter, stream, or WebSocket created without 'error' event listener — unhandled errors crash process | high | truecourse | - | new | js/ts |
| reliability/deterministic/process-exit-in-library | process.exit in library code | process.exit() called in library/module code instead of throwing — prevents graceful cleanup by caller | high | truecourse | - | new | js/ts |
| reliability/deterministic/unchecked-array-access | Unchecked array index access | Accessing array by index without bounds check — returns undefined, may cause downstream errors | low | truecourse | - | new | js/ts |
| reliability/deterministic/missing-null-check-after-find | Missing null check after .find() | Array.find() result used directly without null/undefined check — find can return undefined | medium | truecourse | - | new | js/ts |
| reliability/deterministic/catch-rethrow-no-context | Catch and rethrow without adding context | Exception caught and rethrown without wrapping or adding context — loses information about where/why it failed | medium | truecourse | - | new | all |
| reliability/deterministic/console-error-no-context | console.error with just error object | `console.error(err)` without contextual message — hard to trace which operation failed | low | truecourse | - | new | js/ts |
| reliability/deterministic/express-async-no-wrapper | Async Express handler without error wrapper | Async route handler without try-catch or express-async-errors — unhandled rejection crashes server | high | truecourse | - | new | js/ts |
| reliability/deterministic/missing-next-on-error | Express middleware not calling next(err) | Middleware catches error but doesn't call next(err) �� error handler middleware never invoked | medium | truecourse | - | new | js/ts |
| reliability/deterministic/uncaught-exception-no-handler | No uncaughtException/unhandledRejection handler | Node.js process without global error handlers — crashes silently on unexpected errors | high | truecourse | - | new | js/ts |
| reliability/deterministic/shallow-copy-environ | Shallow copy of os.environ | os.environ.copy() does not propagate changes — use os.environ directly or deepcopy | medium | ruff | PLW1507 (ShallowCopyEnviron) | new | python |
| reliability/deterministic/invalid-envvar-default | Invalid os.getenv default type | os.getenv() default should be string or None — passing int/bool is a type error | medium | ruff | PLW1508 (InvalidEnvvarDefault) | new | python |
| reliability/deterministic/flask-error-handler-missing-status | Flask error handler without status code | Flask error handler not setting HTTP status code — returns 200 on error | high | sonar-python | S6863 | new | python |
| reliability/deterministic/async-with-for-resources | Missing async context manager | Async resource not managed with async with statement — resource leak if exception occurs | medium | sonar-python | S7515 | new | python |
| reliability/deterministic/django-decorator-order | Wrong Django decorator order | @receiver (Django) or @route (Flask) decorators should be outermost — inner position causes silent failure | high | sonar-python | S6552 | new | python |
| reliability/deterministic/shebang-error | Shebang line error | Script shebang issues: file has shebang but not executable, executable file without shebang, shebang not referencing Python, shebang with leading whitespace, shebang not on first line — script won't run correctly | medium | ruff | EXE001-EXE005 | new | python |

### Reliability / LLM

| Our Key | Name | Description | Severity | Source | Source ID | Status | Language |
|---------|------|-------------|----------|--------|-----------|--------|----------|
| reliability/llm/missing-retry-logic | Missing retry logic on network calls | External API/service call without retry mechanism — transient failures cause permanent failure | medium | truecourse | - | new | all |
| reliability/llm/missing-circuit-breaker | Missing circuit breaker on external dependency | Repeated calls to failing external service without circuit breaker — cascading failure risk | medium | truecourse | - | new | all |
| reliability/llm/missing-graceful-shutdown | Missing graceful shutdown handler | Server does not handle SIGTERM/SIGINT for clean connection drain and resource cleanup | medium | truecourse | - | new | js/ts |
| reliability/llm/unbounded-queue | Unbounded queue or buffer | Queue/buffer that grows without backpressure — memory exhaustion under load | high | truecourse | - | new | all |
| reliability/llm/missing-idempotency | Non-idempotent mutation endpoint | POST/PUT endpoint that creates side effects without idempotency key — unsafe to retry | medium | truecourse | - | new | all |
| reliability/llm/missing-dead-letter-handling | Missing dead letter handling | Message queue consumer without dead letter queue — poison messages block processing forever | medium | truecourse | - | new | all |
| reliability/llm/partial-failure-not-handled | Partial failure in batch operation | Batch operation that fails entirely if one item fails — should handle partial success | medium | truecourse | - | new | all |
| reliability/llm/missing-health-check | Missing health check endpoint | Service without /health or /ready endpoint — orchestrator cannot determine service health | medium | truecourse | - | new | all |
| reliability/llm/stale-cache-no-invalidation | Cache without invalidation strategy | Data cached without TTL, versioning, or invalidation — serves stale data indefinitely | medium | truecourse | - | new | all |
| reliability/llm/missing-correlation-id | Missing request correlation/trace ID | Request handling without propagating correlation ID — cannot trace request across services | medium | truecourse | - | new | all |
| reliability/llm/inconsistent-logging | Inconsistent logging patterns | Mix of console.log, custom logger, and third-party logger in same codebase — hard to configure and filter | low | truecourse | - | new | all |
| reliability/llm/missing-structured-logging | Unstructured log messages | Using string interpolation for logs instead of structured key-value logging — hard to parse and query | low | truecourse | - | new | all |
| reliability/llm/missing-error-monitoring | No error monitoring integration | Application without error tracking service (Sentry, Bugsnag, etc.) — errors only visible in logs | low | truecourse | - | new | all |
| reliability/llm/silent-background-failure | Silent background job failure | Background job/cron/worker that catches errors without alerting or recording failure state | high | truecourse | - | new | all |
| reliability/llm/missing-metrics | Missing performance metrics | No instrumentation for response times, queue depths, or resource utilization — blind to degradation | low | truecourse | - | new | all |
| reliability/llm/missing-request-timeout | Missing server-level request timeout | HTTP server without request timeout — slow clients can hold connections open indefinitely | medium | truecourse | - | new | all |

---

## Summary Statistics

| Domain | Deterministic | LLM | Total |
|--------|--------------|-----|-------|
| Architecture | 24 | 30 | 54 |
| Security | 131 | 7 | 138 |
| Bugs | 362 | 8 | 370 |
| Code Quality | 485 | 12 | 497 |
| Database | 8 | 12 | 20 |
| Performance | 32 | 8 | 40 |
| Reliability | 21 | 16 | 37 |
| **Total** | **1063** | **93** | **1156** |

| Status | Count |
|--------|-------|
| Existing (already implemented) | 37 |
| New (needs implementation) | 1119 |

| Language coverage | Count |
|-------------------|-------|
| all (JS/TS + Python) | 189 |
| js/ts + python (mixed) | 5 |
| js/ts only | 418 |
| python only | 544 |

### Notes

1. **Gitleaks consolidation:** All 222 Gitleaks service-specific secret detection rules are consolidated under a single `security/deterministic/hardcoded-secret` rule. Our existing implementation already covers the most common patterns (AWS keys, GitHub tokens, Slack tokens, JWT, generic password/secret/token variable names). Full coverage would require adding the remaining ~200 vendor-specific regex patterns.

2. **Type-checked rules:** Many @typescript-eslint and SonarJS rules marked "Needs Type Info" require a TypeScript project with tsconfig.json to work. These are included here but may need different implementation approach (LSP-based analysis rather than tree-sitter).

3. **React rules:** React-specific rules are grouped under code-quality but only apply to React/JSX codebases.

4. **AWS/Cloud IaC rules:** Security rules for AWS CDK/CloudFormation/Terraform are grouped separately since they only apply to infrastructure-as-code projects.

5. **Python rules:** Rules sourced from Ruff (flake8-bandit, flake8-bugbear, Pylint, flake8-async, flake8-simplify, flake8-comprehensions, flake8-return, flake8-logging, flake8-pytest-style, perflint, refurb, tryceratops, pandas-vet, numpy, pydocstyle, pep8-naming, etc.) and SonarPython. ~50 existing JS/TS rules were updated to `Language: all` where the same concept applies to Python. ~507 Python-specific rules covering: security (subprocess injection, unsafe deserialization, hardcoded secrets), bugs (mutable defaults, special method errors, async blocking calls, type mismatches, datetime timezone, mock access, logging errors, type stub errors), code quality (comprehension simplification, boolean traps, logging best practices, type hints, pytest patterns, ML/data science frameworks, pyupgrade modernization, naming conventions, docstring completeness, formatting, type stub style), and performance (unnecessary allocations, dict iterators, comprehensions, DataLoader workers). Framework-specific rules include Django, Flask, FastAPI, Pydantic, NumPy, Pandas, TensorFlow, PyTorch, Scikit-Learn, and AWS Lambda/boto3.

6. **Python sources:** `ruff` = Ruff linter rules (flake8-bandit/S, flake8-bugbear/B, Pylint/PL, flake8-async/ASYNC, etc.), `sonar-python` = SonarPython analyzer rules. Many rules exist in both sources and are deduplicated with both IDs listed.
