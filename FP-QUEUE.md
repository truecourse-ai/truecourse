# FP Fix Queue — derived from parallel-agent classification

This queue is the consolidated output of 6 classification agents that read every unfixed rule across documenso + OpenHands (487 rules total), with up to 8 samples per rule and source context where ambiguous. Already-fixed rule classes (FP #1 → #26) excluded.

Order is by **impact** (count × confidence) — highest first. Each entry is a candidate; verify with the strict fixture-first cycle before fixing (per `FP-FIX-STRATEGY.md`).

## Tier 1 — High impact, clear FP shape (>50 findings or unambiguous)

### `code-quality/deterministic/expression-complexity` (351 documenso)
**Shape:** Recurses into the body of an arrow function or the JSX subtree of the assigned/returned expression, accumulating operator counts from every nested expression in the entire component render. The function-boundary skip is for descendants but the rule still walks INTO the function/JSX when the expression IS one.
**Fix:** When the candidate expression is itself an `arrow_function`, `function_expression`, JSX, or a `return_statement` returning JSX, return early — don't recurse.
**Examples:** `apps/remix/app/components/dialogs/ai-field-detection-dialog.tsx:61, :162`, `envelope-distribute-dialog.tsx:78`.

### `bugs/deterministic/missing-error-boundary` (90 documenso)
**Shape:** Regex-matches `useQuery` and concludes a React error boundary is needed. Fires on every tRPC `trpc.x.y.useQuery({...})` consumer — but tRPC is non-suspense by default; errors come back via `.error` field, never thrown during render.
**Fix:** Narrow detection to the import source (`@tanstack/react-query` for suspense:true, `useSuspenseQuery`); skip tRPC.
**Examples:** `apps/remix/app/components/dialogs/{admin-swap-subscription-dialog,document-move-to-folder-dialog,envelope-distribute-dialog}.tsx:1`.

### `reliability/deterministic/unchecked-array-access` (80+43 = 123)
**Shape:** Fires on `Record<K, V>` lookups (typed object/map) treated as array indexing. Bracket access on `Record<UnionKey, T>` is exhaustive by construction — never undefined.
**Fix:** Use typeQuery to confirm the receiver IS an array; otherwise skip. (Existing parenthesized-cast skip is too narrow.)
**Examples:** `apps/remix/app/components/dialogs/organisation-create-dialog.tsx:306` (`plans[planId]`), `organisation-leave-dialog.tsx:92` (`ORGANISATION_MEMBER_ROLE_MAP[role]`); OpenHands `hooks-modal.tsx:36`, `conversation-tab-content.tsx:58`.

### `performance/deterministic/runtime-cast-overhead` (59 OpenHands)
**Shape:** Treats every `str(x)` as a no-op cast, but most are int→str conversions for query params, IDs, etc.
**Fix:** When the argument is non-string-typed (number, UUID, etc.), this is a conversion not a cast — skip.
**Examples:** `enterprise/integrations/gitlab/gitlab_service.py:106` (`str(page)` where `page: int`), `github_view.py:445` (`str(workflow.id)`).

### `code-quality/deterministic/filename-class-mismatch` (41+57 = 98)
**Shape:** Two distinct FPs:
1. **Re-export default**: `export default ComponentX` where `ComponentX` was IMPORTED into the file — there's no class declared here to match. Skip when the exported identifier originates from an import_specifier.
2. **Suffixed kebab-case**: `conversation-service.api.ts` exports `ConversationService` — kebab-case → PascalCase, with `.api`/`.service`/`.client` suffix stripped. The rule doesn't normalize.
**Examples:** documenso `apps/remix/app/routes/_authenticated+/settings+/.../{billing-personal,branding,document}.tsx:5`; OpenHands `frontend/src/api/conversation-service/conversation-service.api.ts`.

### `architecture/deterministic/dead-method` (47 documenso)
**Shape:** Object-literal shorthand methods (`onSuccess`, `onError`, `onSettled`, `onMutate`, `validate`, `transform`) inside config args to `useMutation` / `useQuery` / `useForm` are extracted as standalone methods — but the library invokes them via property dispatch, no static caller.
**Fix:** Extend the existing "handle*"/"on*" prefix skip to recognize known callback names appearing as object-literal shorthand methods inside known framework hook calls.
**Examples:** `apps/remix/app/components/dialogs/token-delete-dialog.tsx:60`, `apps/remix/app/components/forms/token.tsx:79`, `packages/lib/jobs/client/base.ts:12,16,26`.

### `architecture/deterministic/unused-export + dead-module` (40+35 = 75 documenso)
**Shape:** Filesystem-routed framework files — Remix `app/routes/**`, Next.js `app/**/(page|route|layout).tsx`, BullMQ-style auto-loaded jobs in `packages/lib/jobs/definitions/**`, server entrypoints like `apps/remix/server/load-context.ts`. The framework discovers them by path; no static import.
**Fix:** Add path-pattern detection to `entryPointFiles` for these conventions.
**Examples:** `apps/remix/app/routes/_authenticated+/o.$orgUrl.settings.{billing,branding,email}.tsx`, `apps/remix/server/load-context.ts:1`, `packages/lib/jobs/definitions/emails/send-document-cancelled-emails.ts:1`.

### `code-quality/deterministic/hardcoded-url` (43 documenso)
**Shape:** Canonical site URLs in framework metadata — `metadataBase`, `host`, `sitemap`, `siteUrl`, `canonical`, `BASE_URL` constants — are configuration values, not service endpoints.
**Fix:** Skip URL strings that are the value of these well-known config keys.
**Examples:** `apps/docs/src/app/layout.tsx:14`, `apps/docs/src/app/robots.ts:9`, `apps/docs/src/app/sitemap.ts:5`.

### `bugs/deterministic/invalid-void-type` (33 OpenHands)
**Shape:** `() => void` callback parameter types are correct TS — `void` is the right return type for "I don't care about the return value". Rule walks into nested function-type returns and flags the legal `void` there.
**Fix:** Don't recurse into function-type return positions; `void` is valid in function-return position.
**Examples:** `frontend/src/components/features/chat/btw-messages.tsx:5`, `mcp-server-list-item.tsx:23`.

### `code-quality/deterministic/getattr-with-constant` (28 OpenHands)
**Shape:** `getattr(self, 'literal', None)` is required when the attribute is dynamically defined on subclass; parent class can't reference it directly. Common in `_get_branch_name`-style polymorphic patterns.
**Fix:** Skip when the access is from inside a class method and the constant matches a name defined on a subclass (or via `hasattr` check earlier).
**Examples:** `enterprise/integrations/github/github_view.py:98`, `enterprise/integrations/gitlab/gitlab_view.py:61`.

### `code-quality/deterministic/class-as-data-structure` (28 OpenHands)
**Shape:** Empty exception subclasses (`class FooError(Exception): pass` or with just a docstring) — they're polymorphism markers for `except FooError`, not data structures.
**Fix:** Skip classes whose only base is `Exception` / `BaseException` / a subclass of those.
**Examples:** `enterprise/storage/org_invitation_models.py:16,25,32,39,46,53`.

### `code-quality/deterministic/commented-out-code` (30 OpenHands)
**Shape:** Plain English comments containing operators (`>= 40`, `== False`) misclassified as commented-out code.
**Fix:** Tighten heuristic — require keywords/punctuation that imply syntax (`;`, `function`, `def`, `=`, `()`) AND lack of natural-language indicators.
**Examples:** `enterprise/integrations/gitlab/gitlab_service.py:418,442,534`, `enterprise/server/auth/token_manager.py:793`.

## Tier 2 — Medium impact, mostly clear FP shape (15-50 findings)

### `code-quality/deterministic/typing-only-import` (441 OpenHands)
Pydantic / SQLAlchemy / dataclass class-attribute annotations are evaluated at runtime by the metaclass/decorator. Imports used only there are NOT type-only.
**Examples:** `enterprise/integrations/bitbucket/bitbucket_v1_callback_processor.py:2` (`from typing import Any` used in Pydantic Field).

### `code-quality/deterministic/no-self-use` (381 OpenHands)
Methods overriding an interface/ABC parent must keep `self` to match the contract. Rule misses polymorphic-override detection.
**Fix:** Skip when the method name matches one in the parent class's signature.
**Examples:** `enterprise/integrations/bitbucket/bitbucket_manager.py:131`.

### `code-quality/deterministic/private-member-access` (81 OpenHands)
Same-class access via static/classmethod (e.g. `JiraFactory._method` from inside JiraFactory). Or same-package convention in Python.
**Fix:** Skip when the receiver class matches the enclosing class.
**Examples:** `enterprise/integrations/jira/jira_view.py:439-453`.

### `code-quality/deterministic/restricted-api-usage` (25 OpenHands)
Scope walk to detect that `event` is a parameter only inspects the closest enclosing function. When `event` is referenced inside an inner callback, the inner function's params don't include `event`.
**Fix:** Walk all enclosing function scopes for the parameter binding, not just the innermost.
**Examples:** `messages.tsx:23`, `hook-execution-event-message.tsx:71-72`.

### `code-quality/deterministic/unnecessary-type-parameter` (26+7 = 33)
Generics used in return types or nested generics (`useDebouncedValue<T>(value: T): T`) are not unnecessary. Rule only checks parameter type usage.
**Examples:** `apps/remix/app/utils/super-json-loader.ts:48`, `frontend/src/hooks/use-click-outside-element.ts:7`.

### `code-quality/deterministic/static-method-candidate` (16+1)
Methods in `abstract` classes (or classes with subclasses) that don't currently use `self`/`this` are polymorphic hooks subclasses override.
**Fix:** Skip when the enclosing class is `abstract` or has known subclasses.
**Examples:** `packages/lib/jobs/client/base.ts:7,12,26`.

### `code-quality/deterministic/react-useless-set-state` (13+2 = 15)
Rule fires on `setX(x)` where `x` is a function parameter that shadows the state variable name. The parameter is the new value being passed in.
**Fix:** Resolve the argument identifier — only fire if it actually reads the state variable, not a shadowing parameter.
**Examples:** `apps/remix/app/components/general/document-signing/document-signing-radio-field.tsx:140`; OpenHands `conversation-websocket-context.tsx:863,875`.

### `bugs/deterministic/void-return-value-used` (7 documenso)
`Array.prototype.splice()` and `pop()` return values; `const [item] = arr.splice(i, 1)` is canonical.
**Fix:** Whitelist `splice` and `pop` (and similar) as non-void.
**Examples:** `apps/remix/app/components/general/envelope-editor/envelope-editor-recipient-form.tsx:402`.

### `bugs/deterministic/missing-return-await` (10 documenso)
Hono's `c.json/c.text/c.redirect/c.html` return `Response` synchronously.
**Fix:** Skip `c.<method>` calls when receiver is a Hono context.
**Examples:** `apps/remix/server/api/download/download.ts:86`.

### `reliability/deterministic/process-exit-in-library` (11 documenso)
All in `packages/api/v1/examples/*.ts` — they ARE example/CLI scripts.
**Fix:** Skip files under `examples/`, `scripts/`, `bin/`, or with a shebang.

### `security/deterministic/insecure-random` (6+3 = 9)
All in seed scripts / MSW mock handlers — non-production.
**Fix:** Skip `seed/`, `seeds/`, `mocks/`, `__mocks__/`, fixture dirs.

### `reliability/deterministic/express-async-no-wrapper` (5 documenso)
Fires on Hono routes — Hono handles async natively.
**Fix:** Detect framework (Hono ≠ Express) and skip non-Express handlers.

### `code-quality/deterministic/unused-private-member + unused-private-method` (6+6 = 12)
Singleton pattern: `private static _instance` accessed inside `getInstance()`; `private constructor()` invoked via `new ClassName()` from static factory.
**Fix:** Follow same-class static-method bodies for internal `new` and `_instance` references.
**Examples:** `packages/lib/jobs/client/inngest.ts:12`, `bullmq.ts:39`.

### `code-quality/deterministic/prefer-const` (8 documenso)
Destructuring assignment `[a, b] = ...` not detected as reassignment of `let a`.
**Fix:** Recognize destructuring patterns as reassignment targets.
**Examples:** `packages/lib/jobs/definitions/internal/seal-document.handler.ts:215-216`.

### `bugs/deterministic/function-return-type-varies` (9 documenso)
Remix loaders that `throw new Response(...)` for not-found and `return {...}` otherwise. Throws aren't returns.
**Fix:** Only consider explicit `return` statements; ignore throws.

### `bugs/deterministic/values-not-convertible-to-number` (6 documenso)
Kysely `sql<boolean>\`1=1\`` tagged-template SQL fragments mis-parsed.
**Fix:** Skip tagged-template-literal call expressions.

### `security/deterministic/hardcoded-ip` (6 documenso, 1 OpenHands)
SVG path `d="..."` coordinates that look like dotted-decimal IPs.
**Fix:** Skip when the parent context is a JSX attribute named `d` (path data) or similar known non-network contexts.

### `architecture/deterministic/data-layer-depends-on-{api,external}` (12+12 = 24)
Layer classification mistakenly tags Remix route files and React component files as data layer.
**Fix:** Update layer-detector — `apps/*/app/components/`, `apps/*/app/routes/` are UI, not data.

### `performance/deterministic/sync-fs-in-request-handler` (10 documenso)
Module-load-time `readFileSync` for static assets (logos, fonts) and seed scripts; not request handlers.
**Fix:** Actually trace from a route entry; skip module-load reads and `seed/` paths.

### `bugs/deterministic/use-before-define` (8 documenso)
Type aliases referencing types defined later (`type X = z.infer<typeof Z>`) and `import { compareSync as bcryptCompareSync }` flagged.
**Fix:** Skip type-only references and import aliases.

### `bugs/deterministic/inconsistent-return` (11 documenso)
Hono middleware `(c, next) => Promise<Response | void>` is the correct signature.
**Fix:** Skip async middleware where one branch returns `next()` and another `await next()`.

### `architecture/deterministic/unused-import` (11 documenso, 87 OpenHands)
`import React` in `.tsx` (classic JSX runtime); `TYPE_CHECKING` imports used in string annotations.
**Fix:** Don't flag `import React` in tsx; recognize string-annotation usage.

### `architecture/deterministic/route-without-auth-middleware` (24 documenso)
Flags `app.use(securityHeadersMiddleware)` middleware definitions; misses inline auth patterns (`getOptionalSession` + 401 returns).
**Fix:** Don't flag `app.use(...)`; recognize inline-auth patterns.

### `code-quality/deterministic/undefined-passed-as-optional` (8+2 = 10)
`createContext<T | undefined>(undefined)` is canonical React idiom; `form.setValue(field, undefined)` clears RHF field.
**Fix:** Skip these well-known idioms.

### `code-quality/deterministic/no-empty-function` (5+21 = 26)
Empty `private constructor()` (singleton); `() => {}` no-op default props.
**Fix:** Skip private constructors and prop-default placeholders.

### `code-quality/deterministic/unused-expression` (6 documenso)
TS `declare global { namespace X {...} }` and short-circuit-call statements `cond && fn()` are intentional.
**Fix:** Skip namespace-augmentation declarations; skip logical-and-call patterns.

### `code-quality/deterministic/use-decorator-syntax` (21 OpenHands)
Class attribute assignments to wrapped callables (`staticmethod(with_http_client(_create_team))`) are not method definitions.
**Fix:** Only fire on `def` definitions, not class-attribute assignments.

### `bugs/deterministic/abstract-class-without-abstract-method` (14 OpenHands)
Generic injector pattern: `class XxxInjector(Injector[X]): pass` — abstract behavior comes from generic parent.
**Fix:** Skip when parent class is generic and the subclass is providing a type binding.

### `code-quality/deterministic/identical-functions` (43+9 = 52)
Tiny inline arrow callbacks like `() => setOpen(false)` across files — independent prop handlers, not duplicate logic.
**Fix:** Skip arrow expressions <30 chars used as JSX prop callbacks.

### `code-quality/deterministic/unnecessary-pass + unnecessary-placeholder-statement` (45+49 = 94)
Abstract Protocol/ABC method bodies with `pass` after docstring — required for syntax in some contexts.
**Fix:** Skip when method body is `"""docstring""" pass` inside an ABC/Protocol class.

### `bugs/deterministic/empty-pattern` (8 OpenHands)
Storybook `render: ({}) => <C/>` — empty destructure of args parameter, intentional in Storybook v7+.
**Fix:** Skip files matching `*.stories.{ts,tsx,js,jsx}`.

### `code-quality/deterministic/implicit-global-declaration` (8 OpenHands)
Top-level functions in service workers (`mockServiceWorker.js`) and standalone scripts.
**Fix:** Skip files explicitly typed as service workers / standalone scripts.

### `code-quality/deterministic/multiple-with-statements` (8 OpenHands)
Single `async with` flagged — appears to count nested with-blocks incorrectly.
**Fix:** Audit the rule's count logic.

### `code-quality/deterministic/clear-text-protocol` (3 documenso, 19 OpenHands)
URL-scheme sanitization helpers that ENFORCE https; SSRF parsers building http strings for inspection.
**Fix:** Skip when the http URL is the second arg to `.replace()`/`.startsWith()`/etc., or constructed inside an SSRF-validation helper.

## Tier 3 — Lower impact / narrower (5-15 findings each)

`missing-null-check-after-find` (13+2) — Konva/jQuery `.find()` returns collections.
`disabled-auto-escaping` (7+2) — detached textarea HTML-entity decoder.
`useless-escape` (1+2) — escapes inside HTML `pattern="..."` regex strings.
`bad-dunder-method-name` (1) — `__post_init__` (dataclasses).
`unused-variable` (2 OpenHands) — SQLAlchemy `TypeDecorator` `impl` class attr.
`non-empty-init-module` (2) — namespace package init.
`subprocess-run-without-check` (1) — local `run()` confused with `subprocess.run`.
`comparison-to-none-constant` (1) — Pythonic `is not None` flagged.
`no-undef` / `unverified-cross-origin-message` (1+1) — service worker globals.
`indexed-loop-over-for-of` (1+1) — two-array index loop.
`sql-injection` (1) — interpolating trusted integer constant.
`insecure-jwt` (1) — HS256 not inherently insecure.
`type-assertion-overuse` (1) — Storybook `.stories.tsx`.
`quadratic-list-summation` (3) — non-loop or short-loop string concat.
`missing-destructuring` (4) — optional-chain reads.
`type-import-side-effects` (7) — inline `type` modifier on import specifiers.
`unnecessary-list-in-iteration` (5) — `list()` REQUIRED when mutating.
`function-call-in-default-argument` (2) — FastAPI `Depends(...)` factories.
`lambda-async-handler` (3) — fires on `async def` exception handlers (named, not lambda).
`database/missing-unique-constraint` (3) — `scalar_one_or_none()` is query method, not schema concern.
`pytest-composite-assertion` (3) — fires outside test files.
`getter-missing-return` / `property-without-return` (3+2) — abstract `@property` with `...`/NotImplementedError.
`case-without-break` (2) — case ends with `return`.
`hardcoded-password-function-arg` (2) — string literals in WebSocket-state setters.
`non-number-arithmetic` (2 OpenHands) — `string.length * number` via ternary.
`element-overwrite` (1) — boolean toggle on `ref.current`.
`unbounded-array-growth` (1) — bounded by while-loop time condition.
`unpredictable-salt-missing` (1) — deterministic-token-lookup hash.
`missing-next-on-error` (1) — Hono middleware (rule assumes Express).
`unused-constructor-result` (1) — validation-by-throw idiom.
`redos-vulnerable-regex` (1+1) — separator-anchored repetition `(?:[-_][a-z0-9]+)*`.
`regex-empty-repetition` / `regex-empty-group` / `regex-anchor-precedence` (5 cumulative) — regex misclassifications.
`missing-super-call` / `this-before-super` (4 cumulative) — fires on classes without `extends`.
`await-non-thenable` (2) — `T | Promise<T>` union flagged.
`unassigned-variable` (2) — property setter / event-handler ordering misses.
`unread-private-attribute` (2) — reads via `instance.x` access.
`useless-constructor` (1) — singleton private constructor.
`js-style-preference` (4) — `var` form required inside `declare global`.

## Recommended ordering

Pick from Tier 1 first — each 50+-finding fix is a measurable win on the post-fix totals. Tier 2 in groups by theme (Hono framework awareness, Python ABC patterns, framework-routed exports). Tier 3 last — many will be quick small fixes where the FP shape is obvious and a 30-line fixture suffices.

For each entry: follow the strict cycle in `FP-FIX-STRATEGY.md` Phase 2. Verify on both targets (Phase 3) before marking done.

## What's NOT in this queue

- Already-fixed FP classes (FP #1 → #26, see `git log --grep "fix(rule:"`).
- `code-quality/deterministic/unsafe-any-usage` (44k+11k) — calibration, not strict FP.
- Style rules already in the strategy doc's known-style list.
- Remaining noise that classification confirmed as TP / measurement.
