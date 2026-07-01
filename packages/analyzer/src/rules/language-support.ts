/**
 * Rule language-support matrix.
 *
 * Every rule carries a status for every analysis language, derived from what
 * actually runs — visitor coverage — plus curated dispositions for the cases
 * derivation can't know (a bug class the language can't express vs. a visitor
 * nobody wrote yet). The enforcement test (rule-language-support.test.ts)
 * keeps statuses and visitor reality from drifting apart.
 */

import type {
  AnalysisLanguage,
  AnalysisRule,
  RuleLanguageStatus,
  RuleLanguageSupport,
  SupportedLanguage,
} from '@truecourse/shared'
import { ANALYSIS_LANGUAGES } from '@truecourse/shared'
import type { CodeRuleVisitor } from './types.js'

/** Grammar variants → analysis language family. */
export const LANGUAGE_FAMILY: Record<SupportedLanguage, AnalysisLanguage> = {
  typescript: 'javascript',
  tsx: 'javascript',
  javascript: 'javascript',
  python: 'python',
  csharp: 'csharp',
}

/**
 * Universal visitors (no `languages` field) cover all language families.
 * Their nodeTypes carry each grammar's node names side by side (`string`,
 * `template_string`, `string_literal`, `interpolated_string_expression`, …)
 * — a new language only counts here after auditing every universal visitor
 * against its grammar (see csharp-universal-rules.test.ts for the C# audit).
 */
export const UNIVERSAL_VISITOR_FAMILIES: readonly AnalysisLanguage[] = ['javascript', 'python', 'csharp']

type Disposition = Partial<Record<AnalysisLanguage, RuleLanguageSupport>>

const NA_COMPILER = (what: string): RuleLanguageSupport => ({
  status: 'not-applicable',
  reason: `inexpressible in C#: ${what}`,
})

const REQUIRES_TYPE_CHECKER: RuleLanguageSupport = {
  status: 'unsupported',
  reason:
    'requires a type checker (Roslyn); analyze is build-free by design — the .NET SDK’s built-in analyzers cover this at compile time',
}

/**
 * Curated dispositions. Only statuses derivation can't produce belong here:
 * `not-applicable` (the language can't express the defect) and permanent
 * `unsupported` reasons. `supported`/`partial` come from visitors existing —
 * adding them here without a visitor fails the enforcement test.
 */
export const RULE_LANGUAGE_DISPOSITIONS: Record<string, Disposition> = {
  // Deliberate C# duplicates: another rule already covers the hazard on C#, so
  // we don't double-fire.
  'code-quality/deterministic/debugger-statement': {
    csharp: { status: 'not-applicable', reason: 'duplicate of no-debugger on C# (both detect Debugger.Break()/Launch())' },
  },
  'security/deterministic/hardcoded-ip': {
    csharp: { status: 'not-applicable', reason: 'duplicate of hardcoded-ip-address on C# (the Roslyn-host rule, which excludes non-routable ranges)' },
  },

  // --- Type-system rules the C# compiler enforces: the offending code does
  // --- not compile, so there is nothing for analyze to find.
  'bugs/deterministic/argument-type-mismatch': { csharp: NA_COMPILER('mismatched arguments are a compile error (CS1503)') },
  'bugs/deterministic/await-non-thenable': { csharp: NA_COMPILER('awaiting a non-awaitable is a compile error (CS1061)') },
  'bugs/deterministic/function-return-type-varies': { csharp: NA_COMPILER('return types are declared and enforced') },
  'bugs/deterministic/loose-boolean-expression': { csharp: NA_COMPILER('conditions must be bool (CS0029)') },
  'bugs/deterministic/misused-promise': { csharp: NA_COMPILER('a Task in a bool position is a compile error') },
  'bugs/deterministic/non-number-arithmetic': { csharp: NA_COMPILER('arithmetic on non-numeric types is a compile error') },
  'bugs/deterministic/unsafe-enum-comparison': { csharp: NA_COMPILER('comparing different enum types is a compile error (CS0019)') },
  'bugs/deterministic/unsafe-unary-minus': { csharp: NA_COMPILER('unary minus on non-numeric types is a compile error') },
  'bugs/deterministic/values-not-convertible-to-number': { csharp: NA_COMPILER('implicit string-to-number coercion does not exist') },
  'bugs/deterministic/void-return-value': { csharp: NA_COMPILER('using a void result is a compile error (CS0029)') },
  'code-quality/deterministic/confusing-void-expression': { csharp: NA_COMPILER('void expressions cannot be used as values') },
  'code-quality/deterministic/unknown-catch-variable': { csharp: NA_COMPILER('catch variables are typed Exception, not unknown/any') },

  // --- Constructs that don't exist in C#.
  'bugs/deterministic/array-sort-without-compare': { csharp: NA_COMPILER('List.Sort uses Comparer<T>.Default, not lexicographic coercion') },
  'bugs/deterministic/misused-spread': { csharp: NA_COMPILER('no spread operator') },
  'bugs/deterministic/restrict-plus-operands': { csharp: NA_COMPILER('operand types are static; string + value concatenation is well-defined') },
  'code-quality/deterministic/react-leaked-render': { csharp: NA_COMPILER('no JSX') },

  // --- Partial C# ports — implemented with a documented recall limitation.
  'architecture/deterministic/unused-import': {
    csharp: {
      status: 'partial',
      reason:
        'alias usings (using X = …) are checked exactly; plain namespace usings need the namespace’s contents, which only a compiler knows',
    },
  },

  // --- Style: per-language conventions and Python/JS-only constructs.
  'style/deterministic/python-naming-convention': {
    csharp: { status: 'not-applicable', reason: 'snake_case conventions are Python’s; the C# analog is style/deterministic/csharp-naming-convention' },
  },
  'style/deterministic/js-naming-convention': {
    csharp: { status: 'not-applicable', reason: 'camelCase function conventions are JS’s; the C# analog is style/deterministic/csharp-naming-convention' },
  },
  'style/deterministic/csharp-naming-convention': {
    javascript: { status: 'not-applicable', reason: '.NET naming conventions; the JS analog is style/deterministic/js-naming-convention' },
    python: { status: 'not-applicable', reason: '.NET naming conventions; the Python analog is style/deterministic/python-naming-convention' },
  },
  'style/deterministic/import-formatting': {
    csharp: { status: 'not-applicable', reason: 'inexpressible in C#: using directives after other members are a compile error (CS1529)' },
  },
  'style/deterministic/implicit-string-concatenation': {
    csharp: { status: 'not-applicable', reason: 'inexpressible in C#: adjacent string literals are a syntax error' },
  },
  'style/deterministic/pytest-decorator-style': {
    csharp: { status: 'not-applicable', reason: 'pytest decorator syntax; C# test frameworks use attributes' },
  },
  'style/deterministic/js-style-preference': {
    csharp: { status: 'not-applicable', reason: 'targets JS var vs const/let; C# var is typed inference with no hoisting hazard' },
  },
  'style/deterministic/ts-declaration-style': {
    csharp: { status: 'not-applicable', reason: 'TS interface-vs-type-alias choice; C# has no structural type aliases' },
  },
  'style/deterministic/python-minor-style-preference': {
    csharp: { status: 'not-applicable', reason: 'PEP 8/Black trailing-comma convention with no .NET counterpart' },
  },

  // --- Database: EF Core / Dapper / ADO.NET ports.
  'database/deterministic/missing-unique-constraint': {
    csharp: { status: 'unsupported', reason: 'EF Core unique constraints live in Fluent API / [Index] attributes that the schema index does not extract; check-then-insert cannot be verified against schema' },
  },
  'database/deterministic/missing-transaction': {
    csharp: { status: 'partial', reason: 'counts syntactically visible round-trip writes (SaveChanges, ExecuteNonQuery, raw write SQL); writes hidden behind helper methods or SQL variables are missed' },
  },
  'database/deterministic/orm-lazy-load-in-loop': {
    csharp: { status: 'partial', reason: 'without type info the loop source must be visibly DB-backed; entity lists arriving via parameters and generic context roots are missed' },
  },
  'database/deterministic/unvalidated-external-data': {
    csharp: { status: 'partial', reason: 'data-flow context has no C# support yet; only direct Request.* access inside write-call arguments is detected, not values passed through locals' },
  },

  // --- Reliability: .NET error model differs from the JS/Python ecosystems.
  'reliability/deterministic/http-call-no-timeout': {
    csharp: { status: 'partial', reason: 'flags new HttpClient() without Timeout in scope (default is a 100s stall per hung call); IHttpClientFactory clients and cross-method configuration are exempt/missed' },
  },
  'reliability/deterministic/missing-null-check-after-find': {
    csharp: { status: 'partial', reason: '*OrDefault() dereferences checked; Find() excluded — MongoDB fluent cursors are syntactically indistinguishable from List/DbSet.Find without types' },
  },
  'reliability/deterministic/floating-promise': {
    csharp: { status: 'partial', reason: 'statement-position un-awaited calls named *Async or known Task factories; third-party Task methods without the Async suffix and inference chains are missed' },
  },
  'reliability/deterministic/missing-error-event-handler': {
    csharp: { status: 'not-applicable', reason: '.NET error propagation is exception-based; there is no error-event convention on streams/emitters' },
  },
  'reliability/deterministic/unchecked-array-access': {
    csharp: { status: 'not-applicable', reason: 'C# indexing throws immediately; the silent-undefined defect is TS-specific' },
  },
  'reliability/deterministic/express-async-no-wrapper': {
    csharp: { status: 'not-applicable', reason: 'ASP.NET natively awaits async handlers; errors reach the middleware pipeline without a wrapper' },
  },
  'reliability/deterministic/missing-next-on-error': {
    csharp: { status: 'not-applicable', reason: 'no next(error) convention; ASP.NET middleware propagates exceptions natively' },
  },
  'reliability/deterministic/uncaught-exception-no-handler': {
    csharp: { status: 'not-applicable', reason: '.NET hosts install top-level handling; registering AppDomain.UnhandledException is not an ecosystem convention' },
  },
  'reliability/deterministic/unhandled-rejection-no-handler': {
    csharp: { status: 'not-applicable', reason: 'unobserved task exceptions have not crashed the process since .NET 4.5; the rejection-handler convention is Node-specific' },
  },
  'reliability/deterministic/empty-reject': {
    csharp: { status: 'not-applicable', reason: 'argument-less SetException()/Task.FromException() do not compile — the construct cannot be written' },
  },
  'reliability/deterministic/shallow-copy-environ': {
    csharp: { status: 'not-applicable', reason: 'Environment.GetEnvironmentVariables() returns a fresh snapshot per call; no aliased mutable global exists' },
  },
  'reliability/deterministic/flask-error-handler-missing-status': {
    csharp: { status: 'not-applicable', reason: 'ASP.NET exception paths default to 500, not 200; the Flask defect does not exist' },
  },
  'reliability/deterministic/async-with-for-resources': {
    csharp: { status: 'not-applicable', reason: 'the compiler rejects sync using on IAsyncDisposable-only types; general cleanup is covered by missing-finally-cleanup' },
  },
  'reliability/deterministic/django-decorator-order': {
    csharp: { status: 'not-applicable', reason: 'ASP.NET filter ordering is by Order property, not attribute syntax order' },
  },
  'reliability/deterministic/shebang-error': {
    csharp: { status: 'not-applicable', reason: 'compiled language; no shebang convention' },
  },

  // --- Performance: .NET runtime/ecosystem differences.
  'performance/deterministic/sync-fs-in-request-handler': {
    csharp: { status: 'partial', reason: 'sync-over-async detected on *Async()-named and Task.-rooted receivers; .Result/.Wait() on a plain Task-typed variable needs a type checker' },
  },
  'performance/deterministic/batch-writes-in-loop': {
    csharp: { status: 'partial', reason: 'Dapper writes require a connection-shaped chain root; repositories wrapping the connection are missed' },
  },
  'performance/deterministic/sorted-for-min-max': {
    csharp: { status: 'partial', reason: 'IQueryable vs in-memory is undecidable without types; DB-shaped roots are skipped (EF translates OrderBy().First() to ORDER BY … LIMIT 1)' },
  },
  'performance/deterministic/event-listener-no-remove': {
    csharp: { status: 'partial', reason: 'receiver lifetime is heuristic (locals skipped, fields/params/statics flagged); cross-file unsubscription is not visible' },
  },
  'performance/deterministic/inline-function-in-jsx-prop': { csharp: { status: 'not-applicable', reason: 'React/JSX render-model construct; no C# equivalent' } },
  'performance/deterministic/inline-object-in-jsx-prop': { csharp: { status: 'not-applicable', reason: 'React/JSX render-model construct; no C# equivalent' } },
  'performance/deterministic/missing-cleanup-useeffect': { csharp: { status: 'not-applicable', reason: 'React hook lifecycle; no C# equivalent' } },
  'performance/deterministic/state-update-in-loop': { csharp: { status: 'not-applicable', reason: 'React state batching; no C# equivalent' } },
  'performance/deterministic/missing-usememo-expensive': { csharp: { status: 'not-applicable', reason: 'React memoization hook; no C# equivalent' } },
  'performance/deterministic/missing-react-memo': { csharp: { status: 'not-applicable', reason: 'React component memoization; no C# equivalent' } },
  'performance/deterministic/unnecessary-context-provider': { csharp: { status: 'not-applicable', reason: 'React context render model; no C# equivalent' } },
  'performance/deterministic/large-bundle-import': { csharp: { status: 'not-applicable', reason: 'no bundler concept; assembly references are compile-time' } },
  'performance/deterministic/sync-require-in-handler': { csharp: { status: 'not-applicable', reason: 'no runtime module-import construct; using directives are compile-time' } },
  'performance/deterministic/synchronous-crypto': { csharp: { status: 'not-applicable', reason: '.NET crypto primitives are CPU-bound with no async counterparts and no event loop to block; the C# analog (sync-over-async) is covered by sync-fs-in-request-handler' } },
  'performance/deterministic/try-except-in-loop': { csharp: { status: 'not-applicable', reason: '.NET try/catch is ~zero-cost on the non-throwing path; the per-iteration overhead premise is Python-specific' } },
  'performance/deterministic/manual-list-comprehension': { csharp: { status: 'not-applicable', reason: 'the loop→LINQ rewrite is slower in C#; a performance rule cannot recommend it' } },
  'performance/deterministic/torch-dataloader-num-workers': { csharp: { status: 'not-applicable', reason: 'PyTorch-only' } },
  'performance/deterministic/missing-slots-in-subclass': { csharp: { status: 'not-applicable', reason: '__slots__ is CPython memory layout; C# fields are statically laid out' } },
  'performance/deterministic/runtime-cast-overhead': { csharp: { status: 'not-applicable', reason: 'static typing makes loop-body conversions required work or free; the avoidable-dynamic-cast premise does not exist' } },

  // --- Security: C# ports land with precision notes; JS/Python-ecosystem
  // --- rules that cannot exist in .NET are not-applicable.
  'security/deterministic/insecure-cookie': {
    csharp: { status: 'partial', reason: 'explicit Secure=false only — omission is legitimately handled by app-wide CookiePolicy middleware' },
  },
  'security/deterministic/cookie-without-httponly': {
    csharp: { status: 'partial', reason: 'explicit HttpOnly=false only — omission is legitimately handled by app-wide CookiePolicy middleware' },
  },
  'security/deterministic/jwt-no-expiry': {
    csharp: { status: 'partial', reason: 'SecurityTokenDescriptor shape analyzed; JwtSecurityToken positional constructors are overload-ambiguous without types' },
  },
  'security/deterministic/weak-crypto-key': {
    csharp: { status: 'partial', reason: 'literal key sizes only; sizes from config/variables are not resolvable' },
  },
  'security/deterministic/unrestricted-file-upload': {
    csharp: { status: 'partial', reason: 'explicit [DisableRequestSizeLimit] only — ASP.NET’s default 30 MB limit covers omission' },
  },
  'security/deterministic/eval-usage': {
    csharp: { status: 'partial', reason: 'CSharpScript evaluation only; Assembly.Load is idiomatic plugin loading and not flagged' },
  },
  'security/deterministic/unverified-hostname': {
    csharp: { status: 'not-applicable', reason: 'no separate hostname toggle in .NET; hostname checks go through the certificate callback (covered by unverified-certificate)' },
  },
  'security/deterministic/ssl-version-unsafe': {
    csharp: { status: 'not-applicable', reason: 'protocol choice is the SslProtocols enum, covered by weak-ssl; no min-version API exists' },
  },
  'security/deterministic/ssl-no-version': {
    csharp: { status: 'not-applicable', reason: 'SslProtocols.None is the recommended OS-default in .NET; flagging it is a guaranteed false positive' },
  },
  'security/deterministic/disabled-auto-escaping': {
    csharp: { status: 'not-applicable', reason: 'Razor escapes by default with no global disable; Html.Raw bypasses live in .cshtml views we do not parse' },
  },
  'security/deterministic/unsafe-markup': {
    csharp: { status: 'not-applicable', reason: 'Razor escapes by default; raw-markup bypasses live in .cshtml views we do not parse' },
  },
  'security/deterministic/dynamically-constructed-template': {
    csharp: { status: 'not-applicable', reason: 'server-side template construction is a JS/Python engine pattern; Razor templates are compiled' },
  },
  'security/deterministic/missing-helmet-middleware': {
    csharp: { status: 'not-applicable', reason: 'helmet is an Express middleware; no C# counterpart package shape' },
  },
  'security/deterministic/missing-content-security-policy': {
    csharp: { status: 'not-applicable', reason: 'helmet option shape; ASP.NET sets headers via middleware with no canonical package to detect' },
  },
  'security/deterministic/missing-frame-ancestors': {
    csharp: { status: 'not-applicable', reason: 'helmet option shape; no C# counterpart' },
  },
  'security/deterministic/missing-strict-transport': {
    csharp: { status: 'not-applicable', reason: 'helmet option shape; UseHsts presence/absence needs whole-pipeline view' },
  },
  'security/deterministic/missing-referrer-policy': {
    csharp: { status: 'not-applicable', reason: 'helmet option shape; no C# counterpart' },
  },
  'security/deterministic/missing-mime-sniff-protection': {
    csharp: { status: 'not-applicable', reason: 'helmet option shape; no C# counterpart' },
  },
  'security/deterministic/hidden-file-exposure': {
    csharp: { status: 'not-applicable', reason: 'express.static dotfiles option; no C# counterpart' },
  },
  'security/deterministic/link-target-blank': {
    csharp: { status: 'not-applicable', reason: 'JSX/HTML markup rule; views are not parsed' },
  },
  'security/deterministic/mixed-content': {
    csharp: { status: 'not-applicable', reason: 'JSX/HTML markup rule; views are not parsed' },
  },
  'security/deterministic/disabled-resource-integrity': {
    csharp: { status: 'not-applicable', reason: 'JSX/HTML markup rule; views are not parsed' },
  },
  'security/deterministic/dompurify-unsafe-config': {
    csharp: { status: 'not-applicable', reason: 'JS sanitizer library' },
  },
  'security/deterministic/angular-sanitization-bypass': {
    csharp: { status: 'not-applicable', reason: 'Angular API' },
  },
  'security/deterministic/unverified-cross-origin-message': {
    csharp: { status: 'not-applicable', reason: 'browser postMessage API' },
  },
  'security/deterministic/intrusive-permissions': {
    csharp: { status: 'not-applicable', reason: 'browser permissions API' },
  },
  'security/deterministic/session-not-regenerated': {
    csharp: { status: 'not-applicable', reason: 'express-session fixation pattern; SignInAsync reissues the auth cookie' },
  },
  'security/deterministic/session-cookie-on-static': {
    csharp: { status: 'not-applicable', reason: 'express-specific static-route session behavior' },
  },
  'security/deterministic/express-trust-proxy-not-set': {
    csharp: { status: 'not-applicable', reason: 'express-specific; forwarded headers are explicit opt-in middleware in ASP.NET' },
  },
  'security/deterministic/path-command-injection': {
    csharp: { status: 'not-applicable', reason: 'Node path.join→exec flow; the C# analog is covered by user-input-in-path' },
  },
  'security/deterministic/subprocess-security': {
    csharp: { status: 'not-applicable', reason: 'python subprocess API shape; Process separates program from arguments' },
  },
  'security/deterministic/partial-path-execution': {
    csharp: { status: 'not-applicable', reason: 'flagging PATH-resolved names would FP on idiomatic Process.Start("git", …)' },
  },
  'security/deterministic/process-start-no-shell': {
    csharp: { status: 'not-applicable', reason: 'python/Node shell-flag API shape; UseShellExecute is covered by os-command-injection' },
  },
  'security/deterministic/subprocess-without-shell': {
    csharp: { status: 'not-applicable', reason: 'python subprocess API shape' },
  },
  'security/deterministic/process-with-partial-path': {
    csharp: { status: 'not-applicable', reason: 'flagging PATH-resolved names would FP on idiomatic Process.Start usage' },
  },
  'security/deterministic/non-octal-file-permissions': {
    csharp: { status: 'not-applicable', reason: 'UnixFileMode is an enum of flags; the octal/decimal confusion cannot be written' },
  },
  'security/deterministic/vulnerable-library-import': {
    csharp: { status: 'not-applicable', reason: 'python module blocklist' },
  },
  'security/deterministic/unsafe-yaml-load': {
    csharp: { status: 'not-applicable', reason: 'YamlDotNet is safe by default; the C# deserialization analog is covered by unsafe-pickle-usage' },
  },
  'security/deterministic/unsafe-temp-file': {
    csharp: { status: 'not-applicable', reason: 'tempfile.mktemp race; GetTempFileName creates the file atomically' },
  },
  'security/deterministic/flask-secret-key-disclosed': {
    csharp: { status: 'not-applicable', reason: 'Flask config shape; covered by hardcoded-secret and jwt-secret-key-disclosed' },
  },
  'security/deterministic/django-raw-sql': {
    csharp: { status: 'not-applicable', reason: 'Django ORM API; EF raw SQL is covered by sql-injection' },
  },
  'security/deterministic/logging-config-insecure-listen': {
    csharp: { status: 'not-applicable', reason: 'python logging.config.listen API' },
  },
  'security/deterministic/unsafe-torch-load': {
    csharp: { status: 'not-applicable', reason: 'PyTorch-only' },
  },
  'security/deterministic/fastapi-file-upload-body': {
    csharp: { status: 'not-applicable', reason: 'FastAPI-specific upload shape' },
  },
  'security/deterministic/paramiko-call': {
    csharp: { status: 'not-applicable', reason: 'paramiko API; the SSH.NET analog is covered by ssh-no-host-key-verification' },
  },
  'security/deterministic/server-fingerprinting': {
    csharp: { status: 'unsupported', reason: 'Kestrel AddServerHeader omission detection needs a whole-pipeline view across files' },
  },
  'security/deterministic/graphql-dos-vulnerability': {
    csharp: { status: 'unsupported', reason: 'HotChocolate configures limits via DI builder chains across files' },
  },
  'security/deterministic/graphql-introspection-enabled': {
    csharp: { status: 'unsupported', reason: 'HotChocolate configures introspection via DI builder chains across files' },
  },
  'security/deterministic/mass-assignment': {
    csharp: { status: 'unsupported', reason: 'needs type info to distinguish EF entities from DTOs in model binding' },
  },
  'security/deterministic/user-id-from-request-body': {
    csharp: { status: 'unsupported', reason: 'C# model binding is typed (no untyped req.body bag); needs semantic binding info' },
  },
  'security/deterministic/suspicious-url-open': {
    csharp: { status: 'unsupported', reason: 'SSRF detection needs taint tracking; HttpClient with a variable URL is idiomatic' },
  },
  'security/deterministic/process-signaling': {
    csharp: { status: 'unsupported', reason: 'GetProcessById/Kill with a variable PID is idiomatic ops code; needs taint tracking' },
  },

  // --- Bugs: C# port batch dispositions.
  'bugs/deterministic/missing-await': {
    csharp: { status: 'not-applicable', reason: 'duplicate of the reliability/deterministic/floating-promise C# port (statement-position un-awaited *Async call)' },
  },
  'bugs/deterministic/unhandled-promise': {
    csharp: { status: 'not-applicable', reason: 'duplicate of the reliability/deterministic/floating-promise C# port' },
  },
  'bugs/deterministic/unthrown-error': {
    csharp: { status: 'not-applicable', reason: 'covered by the useless-exception-statement C# port' },
  },
  'bugs/deterministic/no-self-compare': {
    csharp: { status: 'not-applicable', reason: 'folded into the self-comparison C# port' },
  },
  'bugs/deterministic/use-isnan': {
    csharp: { status: 'not-applicable', reason: 'folded into the nan-comparison C# port (C# spells it double.NaN)' },
  },
  'bugs/deterministic/restrict-template-expressions': {
    csharp: { status: 'not-applicable', reason: 'folded into the base-to-string C# port — C# has a single interpolation mechanism' },
  },
  'bugs/deterministic/loop-at-most-one-iteration': {
    csharp: { status: 'partial', reason: 'covers all-paths-exit-first-iteration shapes that unreachable-loop misses (if/else exits, dead trailing statements, non-block bodies); the trailing plain-exit shape stays with unreachable-loop' },
  },
  'bugs/deterministic/duplicate-dict-key': {
    csharp: { status: 'not-applicable', reason: 'covered by the duplicate-keys C# port' },
  },
  'bugs/deterministic/bad-string-format-character': {
    csharp: { status: 'not-applicable', reason: 'composite formatting is covered by string-format-mismatch; %-formatting does not exist' },
  },
  'bugs/deterministic/redos-vulnerable-regex': {
    csharp: { status: 'not-applicable', reason: 'ported in the security domain C# visitors' },
  },
  'bugs/deterministic/bare-except': {
    csharp: { status: 'partial', reason: 'unbound multi-statement straight-line swallowers fire; branching catch-alls belong to reliability/catch-without-error-type, single-statement fallbacks and TryX wrappers are idiomatic' },
  },
  'bugs/deterministic/duplicate-import': {
    csharp: { status: 'not-applicable', reason: 'using-directive duplicates are owned by the architecture/deterministic/duplicate-import C# port' },
  },
  'bugs/deterministic/await-in-loop': {
    csharp: { status: 'not-applicable', reason: 'sequential awaiting of dependent iterations is idiomatic C#; the parallelization hint is not a deterministic defect' },
  },
  'bugs/deterministic/unsafe-type-assertion': {
    csharp: { status: 'not-applicable', reason: 'C# casts are runtime-checked (InvalidCastException); the silent wrong-type assertion defect is TS-specific' },
  },
  'bugs/deterministic/members-differ-only-by-case': {
    csharp: { status: 'not-applicable', reason: 'field `name` + property `Name` is the core C# naming convention' },
  },
  'bugs/deterministic/duplicate-enum-value': {
    csharp: { status: 'not-applicable', reason: 'enum value aliasing is legal and intentional in C#' },
  },
  'bugs/deterministic/raise-without-from-in-except': {
    csharp: { status: 'unsupported', reason: 'wrapping without innerException is often deliberate sanitization; needs intent signals to avoid false positives' },
  },
  'bugs/deterministic/template-curly-in-string': {
    csharp: { status: 'unsupported', reason: 'detecting a missing $ prefix needs scope analysis to beat the message-template false-positive wall' },
  },
  'bugs/deterministic/method-override-contract-change': {
    csharp: { status: 'unsupported', reason: 'requires a type checker (Roslyn); analyze is build-free by design' },
  },
  'bugs/deterministic/switch-exhaustiveness': {
    csharp: { status: 'partial', reason: 'same-file enum declarations only; cross-file enums need the symbol index' },
  },
  'bugs/deterministic/base-to-string': {
    csharp: { status: 'partial', reason: 'same-method locals with same-file type declarations; inferred or cross-file types are missed' },
  },
  'bugs/deterministic/blocking-call-in-async': {
    csharp: { status: 'partial', reason: 'flags .Result/.Wait chained directly on *Async() calls; Task-typed variables need a type checker (post-WhenAll task.Result is idiomatic)' },
  },
  'bugs/deterministic/duplicate-case': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/duplicate-class-members': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/duplicate-args': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/duplicate-function-arguments': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/duplicate-base-classes': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/duplicate-handler-exception': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/default-except-not-last': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/fallthrough-case': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/const-reassignment': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/class-reassignment': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/function-reassignment': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/import-reassignment': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/variable-redeclaration': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/use-before-define': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/no-undef': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/undefined-name': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/undefined-local-variable': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/unassigned-variable': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/inconsistent-return': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/getter-missing-return': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/property-without-return': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/no-constructor-return': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/constructor-return': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/init-return-value': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/no-setter-return': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/setter-return': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/missing-super-call': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/this-before-super': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/super-without-brackets': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/await-outside-async': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/async-constructor': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/only-throw-error': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/raise-literal': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/except-non-exception-class': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/exception-not-from-base-exception': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/return-in-generator': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/break-continue-in-finally': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/return-in-try-except-finally': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/bare-raise-in-finally': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/unsafe-negation': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/incompatible-operator-types': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/dissimilar-type-comparison': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/non-callable-called': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/literal-call': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/extra-arguments-ignored': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/void-return-value-used': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/mixed-enum-values': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/function-call-in-default-argument': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/strip-with-multi-chars': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/loop-variable-overrides-iterator': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/octal-literal': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/octal-escape': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/yield-return-outside-function': {
    csharp: { status: 'not-applicable', reason: 'the C# compiler rejects this construct; the defect cannot exist in compiling code' },
  },
  'bugs/deterministic/ambiguous-div-regex': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/array-callback-missing-return': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/array-callback-return': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/array-delete': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/sparse-array': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/for-in-array': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/in-operator-on-primitive': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/prototype-pollution': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/prototype-builtins-call': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/no-obj-calls': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/global-this-usage': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/wrapper-object-type': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/symbol-description': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/void-zero-argument': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/missing-radix': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/unexpected-multiline': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/case-declaration-leak': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/comma-in-switch-case': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/no-inner-declarations': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/load-before-global-declaration': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/future-reserved-word': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/compare-neg-zero': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/unsafe-optional-chaining': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/contradictory-optional-chain': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/contradictory-non-null-coalescing': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/confusing-non-null-assertion': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/extra-non-null-assertion': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/empty-object-type': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/error-type-any': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/invalid-void-type': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/never-union': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/unsafe-declaration-merging': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/unintentional-type-annotation': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/misused-new-keyword': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/invalid-typeof': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/unbound-method': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/undefined-export': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/stateful-regex': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/template-str-concatenation': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/template-string-not-processed': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/misleading-array-reverse': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/error-swallowed-in-callback': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/empty-pattern': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/delete-variable': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/global-reassignment': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/async-promise-executor': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/no-promise-executor-return': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/promise-executor-return': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/promise-reject-non-error': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/try-promise-catch': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/conditional-hook': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/usestate-object-mutation': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },
  'bugs/deterministic/missing-error-boundary': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only language mechanism with no C# counterpart' },
  },

  // --- Code-quality: C# port batch dispositions.
  'code-quality/deterministic/boolean-trap': {
    csharp: { status: 'partial', reason: 'only direct calls with ≥2 positional args; member-call setters like SetVisible(true) are deliberately exempt' },
  },
  'code-quality/deterministic/unnecessary-namespace-qualifier': {
    csharp: { status: 'partial', reason: 'exact syntactic match against plain usings; a qualifier kept to disambiguate same-named types from two imported namespaces is still flagged' },
  },
  'code-quality/deterministic/boolean-parameter-default': {
    csharp: { status: 'not-applicable', reason: 'C# optional parameters must declare a compile-time default; the optional-bool-without-default shape cannot exist' },
  },
  'code-quality/deterministic/variable-shadowing': {
    csharp: { status: 'not-applicable', reason: 'CS0136 — shadowing locals/parameters in nested scopes is a compile error; field shadowing by locals is conventional C#' },
  },
  'code-quality/deterministic/duplicate-class-field': {
    csharp: { status: 'not-applicable', reason: 'CS0102 — duplicate member names do not compile' },
  },
  'code-quality/deterministic/case-without-break': {
    csharp: { status: 'not-applicable', reason: 'CS0163/CS8070 — implicit switch fall-through does not compile' },
  },
  'code-quality/deterministic/redundant-boolean': {
    csharp: { status: 'unsupported', reason: 'x == true on bool? is the standard null-handling idiom; distinguishing bool from bool? requires a type checker' },
  },
  'code-quality/deterministic/unnecessary-boolean-compare': {
    csharp: { status: 'unsupported', reason: 'x == true on bool? is the standard null-handling idiom; distinguishing bool from bool? requires a type checker' },
  },

  // --- Bugs: follow-up port dispositions + Python-only enumeration.
  'bugs/deterministic/unnecessary-equality-check': {
    csharp: { status: 'not-applicable', reason: 'cross-type literal == is a compile error (CS0019); the Equals variant needs a type checker' },
  },
  'bugs/deterministic/null-dereference': {
    csharp: { status: 'unsupported', reason: 'null.Foo() is a compile error (CS0023); the meaningful version requires flow/nullability analysis' },
  },
  'bugs/deterministic/incorrect-string-concat': {
    csharp: { status: 'not-applicable', reason: '"x" + 1 is well-defined idiomatic C#; the precedence variant needs operand type info' },
  },
  'bugs/deterministic/shared-mutable-module-state': {
    csharp: { status: 'not-applicable', reason: 'the C# form (mutable static field) is owned by the architecture/deterministic/declarations-in-global-scope C# port' },
  },
  'bugs/deterministic/inconsistent-tuple-return-length': {
    csharp: { status: 'not-applicable', reason: 'the declared return type fixes tuple arity; mismatches are compile errors' },
  },
  'bugs/deterministic/getter-setter-type-mismatch': {
    csharp: { status: 'not-applicable', reason: 'C# property get/set share the single declared property type — compiler-enforced' },
  },
  'bugs/deterministic/math-isclose-zero-no-abstol': {
    csharp: { status: 'not-applicable', reason: 'no .NET BCL analog of math.isclose (no rel_tol/abs_tol API to misuse)' },
  },
  'bugs/deterministic/datetime-without-timezone': {
    csharp: { status: 'partial', reason: 'flags DateTime.Now mixed with UTC values only; bare DateTime.Now is legitimate local-time display and unportable without intent' },
  },
  'bugs/deterministic/race-condition-assignment': {
    csharp: { status: 'partial', reason: 'compound assignment with await on shared-state-shaped targets (this.X, _x, static members); locals and cross-method flows are out of scope' },
  },
  'bugs/deterministic/regex-invalid-python': {
    csharp: { status: 'not-applicable', reason: 'covered by the invalid-regexp C# port (.NET-semantics validator)' },
  },
  'bugs/deterministic/regex-group-reference-mismatch-python': {
    csharp: { status: 'not-applicable', reason: 'covered by the regex-group-reference-mismatch C# port' },
  },
  'bugs/deterministic/logging-exception-no-exc-info': {
    csharp: { status: 'not-applicable', reason: 'python logging API; the C# analog is covered by the lost-error-context port' },
  },
  'bugs/deterministic/static-key-dict-comprehension-ruff': {
    csharp: { status: 'not-applicable', reason: 'duplicate twin of static-key-dict-comprehension (ruff key)' },
  },
  'bugs/deterministic/zip-without-strict': {
    csharp: { status: 'not-applicable', reason: 'C# Zip truncates too, but there is no strict overload to recommend' },
  },
  'bugs/deterministic/access-annotations-from-class-dict': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/argument-type-mismatch-python': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/assert-false': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/assert-on-string-literal': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/assert-on-tuple': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/assert-with-print-message': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/assertion-incompatible-types': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/assignment-in-assert': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/assignment-to-os-environ': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/bad-staticmethod-argument': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/binary-op-exception': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/class-mixed-typevars': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/classmethod-first-argument-naming': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/comparison-to-none-constant': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/confusing-implicit-concat': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/datetime-min-max': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/dict-index-missing-items': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/dict-iter-missing-items': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/duplicate-entry-dunder-all': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/except-with-empty-tuple': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/exception-group-misuse': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/exit-method-wrong-signature': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/exit-re-raise-in-except': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/falsy-dict-get-fallback': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/forward-annotation-syntax-error': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/fstring-docstring': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/future-feature-not-defined': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/global-at-module-level': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/hashable-set-dict-member': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/identity-with-dissimilar-types': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/if-tuple-always-true': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/implicit-optional': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/import-self': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/import-star-undefined': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/instance-method-missing-self': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/invalid-all-object': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/invalid-assert-message': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/invalid-envvar-value': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/invalid-index-type': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/invalid-print-syntax': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/invalid-special-method-return-type': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/is-literal-comparison': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/item-operation-unsupported': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/iter-not-returning-iterator': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/iter-returns-iterable': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/lambda-assignment': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/mutable-class-default': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/mutable-default-arg': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/named-expr-without-context': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/non-iterable-unpacking': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/non-slot-assignment': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/none-comparison-with-equality': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/nonlocal-and-global': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/nonlocal-without-binding': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/not-implemented-in-bool-context': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/not-in-operator-incompatible': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/parameter-initial-value-ignored': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/property-param-count-wrong': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/raise-not-implemented': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/redefined-argument-from-local': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/redefined-slots-in-subclass': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/redefined-while-unused': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/redundant-tuple-in-exception': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/runtime-import-in-type-checking': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/self-or-cls-assignment': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/single-string-slots': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/star-arg-after-keyword': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/star-assignment-error': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/type-stub-annotation-error': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/type-stub-version-check-error': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/unary-prefix-increment-decrement': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/unexpected-special-method-signature': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/unreliable-callable-check': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/unsupported-method-call-on-all': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/used-dummy-variable': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/yield-from-in-async': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/yield-in-init': {
    csharp: { status: 'not-applicable', reason: 'Python-only language mechanism; the construct cannot exist in C#' },
  },
  'bugs/deterministic/async-function-with-timeout': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/asyncio-dangling-task': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/bad-open-mode': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/batched-without-strict': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/cancel-scope-no-checkpoint': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/control-flow-in-task-group': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/dataclass-enum-conflict': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/defaultdict-default-factory-kwarg': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/einops-pattern-invalid': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/fstring-in-gettext': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/implicit-classvar-in-dataclass': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/invalid-mock-access': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/invalid-pathlib-with-suffix': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/invalid-pyproject-toml': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/logging-deprecated-warn': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/logging-exception-outside-handler': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/logging-invalid-getlogger': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/map-without-strict': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/ml-reduction-axis-missing': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/mutable-contextvar-default': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/mutable-dataclass-default': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/mutable-fromkeys-value': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/numpy-weekmask-invalid': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/os-path-commonprefix-bug': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/pandas-nunique-constant-series': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/post-init-default': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/pytorch-nn-module-missing-super': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/re-sub-positional-args': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/reuse-groupby-generator': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/scikit-pipeline-cache-direct-access': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/singledispatch-method-mismatch': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/sklearn-estimator-trailing-underscore': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/sklearn-pipeline-invalid-params': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/subprocess-popen-preexec-fn': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/tf-function-side-effects': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/trio-sync-call': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/unreliable-sys-version-check': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/useless-contextlib-suppress': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/warnings-no-stacklevel': {
    csharp: { status: 'not-applicable', reason: 'Python stdlib/PyPI API with no C# counterpart defect' },
  },
  'bugs/deterministic/airflow-usage-error': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/assertion-after-expected-exception': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/django-json-response-safe-flag': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/fastapi-204-with-body': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/fastapi-child-router-order': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/fastapi-cors-middleware-order': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/fastapi-redundant-response-model': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/fastapi-unused-path-parameter': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/flask-class-view-decorator-wrong': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/flask-header-access-keyerror': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/flask-preprocess-return-unhandled': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/flask-query-params-in-post': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/flask-send-file-missing-mimetype': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/lambda-handler-returns-non-serializable': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/lambda-network-call-no-timeout': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/lambda-tmp-not-cleaned': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/legacy-pytest-raises': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/pytest-assert-always-false': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/pytest-fixture-misuse': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },
  'bugs/deterministic/pytest-raises-ambiguous-pattern': {
    csharp: { status: 'not-applicable', reason: 'Python framework (Flask/FastAPI/Django/pytest/Lambda-Python) shape with no C# counterpart' },
  },

  // --- Code-quality: follow-up port dispositions + JS/Python-only enumeration.
  'code-quality/deterministic/no-self-use': {
    csharp: { status: 'not-applicable', reason: 'explicit-self mechanism does not exist; the C# defect is owned by the static-method-candidate port' },
  },
  'code-quality/deterministic/print-statement-in-production': {
    csharp: { status: 'not-applicable', reason: 'Console.WriteLine is C#’s print; owned by the console-log C# port' },
  },
  'code-quality/deterministic/unused-expression': {
    csharp: { status: 'not-applicable', reason: 'CS0201 — no-effect expression statements do not compile' },
  },
  'code-quality/deterministic/useless-expression': {
    csharp: { status: 'not-applicable', reason: 'CS0201 — no-effect expression statements do not compile' },
  },
  'code-quality/deterministic/regex-unicode-awareness': {
    csharp: { status: 'not-applicable', reason: 'JS u-flag mechanism; .NET regexes are always Unicode-aware' },
  },
  'code-quality/deterministic/prefer-regex-exec': {
    csharp: { status: 'not-applicable', reason: 'JS RegExp-object mechanism' },
  },
  'code-quality/deterministic/require-unicode-regexp': {
    csharp: { status: 'not-applicable', reason: 'JS u-flag mechanism; .NET regexes are always Unicode-aware' },
  },
  'code-quality/deterministic/unnecessary-regex-constructor': {
    csharp: { status: 'not-applicable', reason: 'JS regex-literal vs constructor choice; C# has no regex literals' },
  },
  'code-quality/deterministic/test-exclusive': {
    csharp: { status: 'not-applicable', reason: 'xUnit/NUnit/MSTest have no .only-style exclusive-run construct' },
  },
  'code-quality/deterministic/test-code-after-done': {
    csharp: { status: 'not-applicable', reason: 'done() callback is a JS async-test mechanism' },
  },
  'code-quality/deterministic/test-incomplete-assertion': {
    csharp: { status: 'not-applicable', reason: 'CS0201 — an uncalled matcher reference as a statement does not compile' },
  },
  'code-quality/deterministic/test-deterministic-assertion': {
    csharp: { status: 'not-applicable', reason: 'Chai property-assertion semantics; FluentAssertions equivalents are legitimate idiom' },
  },
  'code-quality/deterministic/global-statement': {
    csharp: { status: 'not-applicable', reason: 'no global-variable mechanism in C#' },
  },
  'code-quality/deterministic/no-explicit-any': {
    csharp: { status: 'not-applicable', reason: 'no any type; dynamic is covered by the unsafe-any-usage C# port' },
  },
  'code-quality/deterministic/star-import': {
    csharp: { status: 'not-applicable', reason: 'using Namespace; is the only import form and is idiomatic' },
  },
  'code-quality/deterministic/alert-usage': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/array-constructor': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/associative-array': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/async-promise-function': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/block-scoped-var': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/class-prototype-assignment': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/complex-type-alias': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/computed-enum-value': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/deep-callback-nesting': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/default-parameter-position': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/dot-notation-enforcement': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/duplicate-type-constituent': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/dynamic-delete': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/explicit-any-in-return': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/extend-native': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/for-in-without-filter': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/function-in-block': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/function-in-loop': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/html-table-accessibility': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/implicit-global': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/implicit-global-declaration': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/implicit-type-coercion': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/inconsistent-function-call': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/inferrable-types': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/interface-over-function-type': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/internal-api-usage': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/legacy-has-own-property': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/literal-assertion-over-const': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/meaningless-void-operator': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/missing-boundary-types': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/missing-destructuring': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/missing-return-type': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/mixed-type-exports': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/mixed-type-imports': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/namespace-usage': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-alert': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-caller': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-iterator': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-label-var': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-new-wrappers': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-proto': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-return-await': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-script-url': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-sequences': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-throw-literal': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-var-declaration': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/no-void': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/prefer-const': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/prefer-nullish-coalescing': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/prefer-object-literal': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/prefer-object-spread': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/prefer-rest-params': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/prefer-spread': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/primitive-wrapper': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/react-hook-setter-in-body': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/react-readonly-props': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/react-unstable-key': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/react-useless-set-state': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/reduce-type-cast': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/redundant-optional': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/redundant-overload': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/redundant-type-alias': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/redundant-type-constraint': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/require-import': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/require-yield': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/required-type-annotations': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/restricted-api-usage': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/restricted-types': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/strict-equality': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/string-comparison': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/symbol-description': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/this-aliasing': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/too-many-union-members': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/triple-slash-reference': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/type-guard-preference': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/type-import-side-effects': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/undef-init': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/undefined-as-identifier': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/undefined-assignment': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/undefined-passed-as-optional': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/ungrouped-accessor-pair': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/ungrouped-shorthand-properties': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-bind': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-call-apply': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-label': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-parameter-property-assignment': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-promise-wrap': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/unsafe-function-type': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/unused-scope-definition': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/useless-computed-key': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/useless-default-assignment': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/useless-empty-export': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/useless-rename': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/useless-type-intersection': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/verbose-object-constructor': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/with-statement': {
    csharp: { status: 'not-applicable', reason: 'JS/TS-only mechanism (type system, runtime coercion, prototype, React, or browser API) with no C# counterpart' },
  },
  'code-quality/deterministic/airflow-3-migration': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/and-or-ternary': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/any-type-hint': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/assert-in-production': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/assignment-inconsistent-with-hint': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/async-long-sleep': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/async-single-task-group': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/async-unused-async': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/async-zero-sleep': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/aws-cloudwatch-namespace': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/aws-custom-polling': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/aws-hardcoded-region': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/bad-dunder-method-name': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/banned-api-import': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/bare-raise-outside-except': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/blanket-type-ignore': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/boolean-chained-comparison': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/boto3-client-error': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/boto3-pagination': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/builtin-shadowing': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/cached-instance-method': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/check-and-remove-from-set': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/collection-literal-concatenation': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/compare-with-tuple': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/compression-namespace-import': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/confusing-type-check': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/dict-fromkeys-for-constant': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/dict-get-none-default': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/django-locals-in-render': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/django-model-form-fields': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/django-model-without-str': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/django-nullable-string-field': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/django-receiver-decorator-order': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/django-unordered-body-content': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/duplicate-isinstance-call': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/duplicate-union-literal-member': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/empty-method-without-abstract': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/empty-type-checking-block': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/enumerate-for-loop': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/exception-base-class': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/explicit-fstring-conversion': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/fastapi-generic-route-decorator': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/fastapi-import-string': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/fastapi-non-annotated-dependency': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/fastapi-router-prefix': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/fastapi-testclient-content': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/fastapi-undocumented-exception': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/field-duplicates-class-name': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/flask-rest-verb-annotation': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/future-annotations-import': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/generic-type-unparameterized': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/getattr-with-constant': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/global-variable-not-assigned': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/if-else-dict-lookup': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/if-else-instead-of-dict-get': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/implicit-return': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/import-outside-top-level': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/import-private-name': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/in-dict-keys': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/invalid-escape-sequence': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/isinstance-type-none': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/iteration-over-set': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/lambda-async-handler': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/lambda-init-resources': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/lambda-reserved-env-var': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/lambda-sync-invocation': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/legacy-generic-syntax': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/legacy-type-hint-syntax': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/literal-membership-test': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/logging-direct-instantiation': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/logging-exc-info-instead-of-exception': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/logging-extra-attr-clash': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/logging-redundant-exc-info': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/logging-root-logger-call': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/magic-value-comparison': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/manual-from-import': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/map-int-version-parsing': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/metaclass-abcmeta': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/missing-maxsplit-arg': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/missing-type-hints': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/ml-missing-hyperparameters': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/multiple-with-statements': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/needless-bool': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/needless-else': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/negated-comparison': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/non-empty-init-module': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/numpy-deprecated-type-alias': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/numpy-legacy-random': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/numpy-list-to-array': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/numpy-nonzero-preferred': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/numpy-reproducible-random': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pandas-accessor-preference': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pandas-datetime-format': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pandas-deprecated-accessor': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pandas-inplace-argument': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pandas-merge-parameters': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pandas-pipe-preferred': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pandas-read-csv-dtype': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pandas-use-of-dot-values': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pprint-usage': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/prefer-pathlib': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/print-empty-string': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/private-member-access': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/property-with-parameters': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pydantic-optional-default': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pytest-assert-in-except': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pytest-composite-assertion': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pytest-duplicate-parametrize': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pytest-fail-without-message': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pytest-raises-multiple-statements': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pytest-suboptimal-pattern': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pytest-unittest-assertion': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pytest-warns-issues': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/python-idiom-simplification': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pytz-deprecated': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/pyupgrade-modernization': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/raise-vanilla-args': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/raw-string-in-exception': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/read-write-whole-file': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/readlines-in-for': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/redeclared-assigned-name': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/redefined-loop-name': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/redundant-collection-function': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/reimplemented-container-builtin': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/reimplemented-operator': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/repeated-append': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/return-not-implemented': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/return-type-inconsistent-with-hint': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/self-first-argument': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/sklearn-pipeline-memory': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/slice-to-remove-prefix-suffix': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/sorted-reversed-redundant': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/split-static-string': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/starmap-zip-simplification': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/startswith-endswith-tuple': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/static-join-to-fstring': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/stop-iteration-in-generator': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/suppressible-exception': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/swap-variables-pythonic': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/sys-exit-alias': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/system-exit-not-reraised': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/template-string-pattern-matching': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/test-not-discoverable': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/test-skipped-implicitly': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/tf-function-global-variable': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/tf-function-recursive': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/tf-gather-validate-indices': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/tf-keras-input-shape': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/tf-variable-singleton': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/torch-autograd-variable': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/torch-model-eval-train': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/try-consider-else': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/try-except-continue': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/try-except-pass': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/type-check-without-type-error': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/type-checking-alias-annotation': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/type-stub-style': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/typing-only-import': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unittest-specific-assertion': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-cast-to-int': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-dict-index-lookup': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-dict-kwargs': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-dict-spread': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-direct-lambda-call': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-dunder-call': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-empty-iterable-in-deque': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-generator-comprehension': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-key-check': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-list-in-iteration': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-list-index-lookup': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-pass': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-placeholder-statement': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-range-start': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-round': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unnecessary-type-union': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unspecified-encoding': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unused-annotation': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/unused-unpacked-variable': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/use-bit-count': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/use-decorator-syntax': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/useless-else-on-loop': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/useless-if-else': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/useless-import-alias': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/useless-try-except': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/verbose-log-message': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/verbose-raise': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/zip-dict-keys-values': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },
  'code-quality/deterministic/zip-instead-of-pairwise': {
    csharp: { status: 'not-applicable', reason: 'Python-only syntax, idiom, type-hint mechanism, or library (Django/FastAPI/pytest/numpy/pandas/TF/torch/boto3) with no C# counterpart' },
  },

  // --- Security: AWS CDK infrastructure rules — deferred pending CDK-for-.NET shapes.
  'security/deterministic/aws-iam-all-privileges': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-iam-all-resources': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-iam-all-resources-python': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-iam-overly-broad-policy': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-iam-privilege-escalation': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-iam-public-access': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-public-api': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-public-api-python': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-public-policy': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-public-resource': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-s3-bucket-access': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-s3-insecure-http': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-s3-no-versioning': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-s3-no-versioning-python': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-s3-public-access': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-ebs': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-ebs-python': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-efs': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-efs-python': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-opensearch': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-opensearch-python': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-rds': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-rds-python': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-sagemaker': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-sagemaker-python': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-sns': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-sns-python': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-sqs': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unencrypted-sqs-python': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unrestricted-admin-access': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unrestricted-admin-ip': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/aws-unrestricted-outbound': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/s3-missing-bucket-owner': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/s3-public-bucket-access': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },
  'security/deterministic/s3-unrestricted-access': {
    csharp: { status: 'unsupported', reason: 'CDK for .NET encodes these in strongly-typed props classes where the defect is an insecure-by-default omission; a zero-FP port needs dedicated CDK-for-.NET shape work' },
  },

  'bugs/deterministic/regex-empty-alternative-python': {
    csharp: { status: 'not-applicable', reason: 'covered by the code-quality regex-empty-alternative C# port' },
  },
  'bugs/deterministic/assert-raises-too-broad': {
    csharp: { status: 'partial', reason: 'typeof/MSTest/NUnit-classic broad-exception shapes fire; the generic Assert.Throws<Exception> shape is owned by code-quality/test-missing-exception-check' },
  },

  // --- Code-quality: tail port dispositions.
  'code-quality/deterministic/elseif-without-else': {
    csharp: { status: 'not-applicable', reason: 'ending an if/else-if chain without else is idiomatic C#; exhaustiveness lives in switch' },
  },
  'code-quality/deterministic/public-static-readonly': {
    csharp: { status: 'not-applicable', reason: 'the C# form (mutable static field) is owned by the architecture/deterministic/declarations-in-global-scope C# visitor' },
  },
  'code-quality/deterministic/redundant-assignment': {
    csharp: { status: 'not-applicable', reason: 'x = x is owned by the bugs/deterministic/self-assignment C# visitor' },
  },
  'code-quality/deterministic/redundant-template-expression': {
    csharp: { status: 'unsupported', reason: 'whether $"{x}" is redundant depends on x being a string; on non-strings it is the idiomatic null-safe ToString — needs a type checker' },
  },
  'code-quality/deterministic/selector-parameter': {
    csharp: { status: 'not-applicable', reason: 'bool selector parameters are institutionalized .NET patterns (Dispose(bool), leaveOpen, ignoreCase); call-site readability is owned by boolean-trap' },
  },
  'code-quality/deterministic/abstract-class-without-abstract-method': {
    csharp: { status: 'not-applicable', reason: 'C# abstract is compiler-enforced non-instantiation regardless of abstract members; the ABC-marker defect cannot occur' },
  },
  'code-quality/deterministic/nested-min-max': {
    csharp: { status: 'not-applicable', reason: 'Math.Min/Max are strictly binary in .NET; nesting IS the standard composition' },
  },
  'code-quality/deterministic/non-unique-enum-values': {
    csharp: { status: 'not-applicable', reason: 'enum value aliasing is legal and intentional C# (same reasoning as bugs/deterministic/duplicate-enum-value)' },
  },
  'code-quality/deterministic/subprocess-run-without-check': {
    csharp: { status: 'not-applicable', reason: 'Process.Start is fire-and-forget by design; flagging Start without ExitCode would FP on idiomatic launches' },
  },
  'code-quality/deterministic/unnecessary-assign-before-return': {
    csharp: { status: 'not-applicable', reason: 'identical C# shape owned by the code-quality/deterministic/prefer-immediate-return port (block-level, covers both)' },
  },
  'code-quality/deterministic/unnecessary-lambda': {
    csharp: { status: 'unsupported', reason: 'method-group conversion validity depends on delegate vs Expression<> targets and overload sets — IDE0200 is a semantic analyzer' },
  },
  'code-quality/deterministic/require-await': {
    csharp: { status: 'not-applicable', reason: 'CS1998 already warns, and async-without-await has established intentional semantics (exceptions wrap into the returned Task)' },
  },

  // --- Genuinely need full type information; analyze stays build-free.
  'code-quality/deterministic/unnecessary-condition': { csharp: REQUIRES_TYPE_CHECKER },
  'code-quality/deterministic/unnecessary-type-assertion': { csharp: REQUIRES_TYPE_CHECKER },
  'code-quality/deterministic/unnecessary-type-conversion': { csharp: REQUIRES_TYPE_CHECKER },
  'code-quality/deterministic/redundant-type-argument': { csharp: REQUIRES_TYPE_CHECKER },
  'code-quality/deterministic/unnecessary-type-parameter': { csharp: REQUIRES_TYPE_CHECKER },
  'code-quality/deterministic/readonly-parameter-types': { csharp: REQUIRES_TYPE_CHECKER },
  'code-quality/deterministic/prefer-this-return-type': { csharp: REQUIRES_TYPE_CHECKER },
}

const NOT_IMPLEMENTED: RuleLanguageSupport = {
  status: 'unsupported',
  reason: 'no visitor implemented for this language yet',
}

const UNIVERSAL_NOT_AUDITED: RuleLanguageSupport = {
  status: 'unsupported',
  reason: 'universal visitor not yet audited against the C# grammar (node-type names differ)',
}

const UNIVERSAL_EXCLUDED: RuleLanguageSupport = {
  status: 'not-applicable',
  reason: 'universal visitor deliberately excludes this language (covered by a more precise rule)',
}

const GRAPH_LEVEL_SUPPORTED: RuleLanguageSupport = { status: 'supported' }
const LLM_SUPPORTED: RuleLanguageSupport = { status: 'supported' }

/**
 * Populate `languageSupport` on every rule from visitor coverage + curated
 * dispositions. Idempotent and pure — returns new rule objects.
 */
export function withLanguageSupport(rules: AnalysisRule[], visitors: CodeRuleVisitor[]): AnalysisRule[] {
  // ruleKey → families covered by language-specific visitors / universal visitors
  const explicitFamilies = new Map<string, Set<AnalysisLanguage>>()
  const universalRuleKeys = new Set<string>()
  // Families a universal visitor opts out of (e.g. superseded by a host rule).
  const universalExcludedFamilies = new Map<string, Set<AnalysisLanguage>>()
  for (const visitor of visitors) {
    if (!visitor.languages) {
      universalRuleKeys.add(visitor.ruleKey)
      if (visitor.excludeLanguages) {
        const excluded = universalExcludedFamilies.get(visitor.ruleKey) ?? new Set<AnalysisLanguage>()
        for (const lang of visitor.excludeLanguages) excluded.add(LANGUAGE_FAMILY[lang])
        universalExcludedFamilies.set(visitor.ruleKey, excluded)
      }
      continue
    }
    if (!explicitFamilies.has(visitor.ruleKey)) explicitFamilies.set(visitor.ruleKey, new Set())
    for (const lang of visitor.languages) {
      explicitFamilies.get(visitor.ruleKey)!.add(LANGUAGE_FAMILY[lang])
    }
  }

  return rules.map((rule) => {
    const support: Partial<Record<AnalysisLanguage, RuleLanguageSupport>> = {}
    const dispositions = RULE_LANGUAGE_DISPOSITIONS[rule.key]

    for (const language of ANALYSIS_LANGUAGES) {
      const curated = dispositions?.[language]
      if (curated) {
        support[language] = curated
        continue
      }

      if (rule.type === 'llm') {
        // LLM prompts read source text — language-agnostic by construction
        support[language] = LLM_SUPPORTED
        continue
      }

      if (rule.category !== 'code') {
        // Service/module/method/database rules run on the language-agnostic
        // graph (services, modules, dependencies, schema index)
        support[language] = GRAPH_LEVEL_SUPPORTED
        continue
      }

      if (rule.engine === 'roslyn-host' || rule.engine === 'roslyn-workspace') {
        // Implemented in the C# Roslyn semantic host.
        // `roslyn-workspace` additionally needs the real project loaded.
        if (language === 'csharp') {
          support[language] = { status: 'supported' }
          continue
        }
        // A small number of rules are hybrid: Roslyn for C#, tree-sitter for
        // other languages (e.g. unused-function-parameter detects implicit
        // interface implementations in C# via Roslyn while JS uses a visitor).
        // If a visitor exists for this non-C# language, honour it as supported.
        const hasExplicitForLang = explicitFamilies.get(rule.key)?.has(language) ?? false
        const universalExcludesLang = universalExcludedFamilies.get(rule.key)?.has(language) ?? false
        const hasUniversalForLang =
          universalRuleKeys.has(rule.key) && UNIVERSAL_VISITOR_FAMILIES.includes(language) && !universalExcludesLang
        if (hasExplicitForLang || hasUniversalForLang) {
          support[language] = { status: 'supported' }
          continue
        }
        support[language] = { status: 'not-applicable', reason: 'C# semantic rule (Roslyn host); no equivalent in this language' }
        continue
      }

      const hasExplicit = explicitFamilies.get(rule.key)?.has(language) ?? false
      const universalExcludesLang = universalExcludedFamilies.get(rule.key)?.has(language) ?? false
      const hasUniversal =
        universalRuleKeys.has(rule.key) && UNIVERSAL_VISITOR_FAMILIES.includes(language) && !universalExcludesLang

      if (hasExplicit || hasUniversal) {
        support[language] = { status: 'supported' }
      } else if (universalExcludesLang) {
        support[language] = UNIVERSAL_EXCLUDED
      } else if (universalRuleKeys.has(rule.key) && language === 'csharp') {
        support[language] = UNIVERSAL_NOT_AUDITED
      } else {
        support[language] = NOT_IMPLEMENTED
      }
    }

    return { ...rule, languageSupport: support }
  })
}

/** Status counts per language — the CLI summary line. */
export function summarizeLanguageSupport(rules: AnalysisRule[]): Record<AnalysisLanguage, Record<RuleLanguageStatus, number>> {
  const summary = {} as Record<AnalysisLanguage, Record<RuleLanguageStatus, number>>
  for (const language of ANALYSIS_LANGUAGES) {
    summary[language] = { supported: 0, partial: 0, 'not-applicable': 0, unsupported: 0 }
  }
  for (const rule of rules) {
    for (const language of ANALYSIS_LANGUAGES) {
      const entry = rule.languageSupport?.[language]
      if (entry) summary[language][entry.status]++
    }
  }
  return summary
}
