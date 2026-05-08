/**
 * Shared helpers for code-quality JS/TS visitors.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { SupportedLanguage } from '@truecourse/shared'

export const JS_LANGUAGES: SupportedLanguage[] = ['typescript', 'tsx', 'javascript']

export const TS_LANGUAGES: SupportedLanguage[] = ['typescript', 'tsx']

export type { SyntaxNode }

export const JS_FUNCTION_TYPES = ['function_declaration', 'function_expression', 'arrow_function', 'method_definition']

export function getFunctionBody(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'method_definition') {
    return node.namedChildren.find((c) => c.type === 'statement_block') ?? null
  }
  return node.childForFieldName('body')
}

export function getFunctionName(node: SyntaxNode): string {
  const nameNode = node.childForFieldName('name')
  return nameNode?.text || 'anonymous'
}

// Helper: extract regex source from a regex_pattern or string node
export function getRegexSource(node: SyntaxNode): string | null {
  if (node.type === 'regex') {
    const pattern = node.namedChildren.find((c) => c.type === 'regex_pattern')
    return pattern?.text ?? null
  }
  if (node.type === 'new_expression') {
    const ctor = node.childForFieldName('constructor')
    if (ctor?.text !== 'RegExp') return null
    const args = node.childForFieldName('arguments')
    const firstArg = args?.namedChildren[0]
    if (firstArg?.type === 'string') {
      return firstArg.text.slice(1, -1) // strip quotes
    }
  }
  return null
}

// Magic numbers: exclude very common / obviously safe literals
export const MAGIC_NUMBER_WHITELIST = new Set([0, 1, 2, -1, 100, 1000])

// Common server/app port numbers that indicate hardcoding
export const COMMON_PORTS = new Set([80, 443, 3000, 3001, 3002, 3003, 4000, 4200, 5000, 5173, 7000, 7001, 8000, 8080, 8081, 8443, 9000, 9090, 9200, 9300])

// Form-library + storage method names whose first string argument
// IS a schema field key, not a refactor candidate. Repeating
// `'teamUrl'` across `form.setValue(...)` / `form.getValues(...)` /
// `form.setError(...)` is structural — the field name is the
// schema, identical to `.get('key')` patterns elsewhere.
export const FIELD_KEY_METHODS = new Set([
  'setValue', 'getValue', 'getValues', 'setError', 'clearErrors',
  'register', 'unregister', 'watch', 'getFieldState', 'trigger',
  'setFocus', 'resetField', 'unregisterField',
  'getItem', 'setItem', 'removeItem',
  't',
  'get', 'set', 'has', 'delete',
  // URLSearchParams / Headers / FormData / Map / WeakMap APIs —
  // first string argument is the key, not a refactor candidate.
  'append',
  // DOM event handlers / emitter APIs: `el.addEventListener('click', …)`,
  // `socket.on('message', …)`, `emitter.off('event', …)`,
  // `event.dispatchEvent(...)`. First arg is the event name.
  'addEventListener', 'removeEventListener', 'on', 'off', 'once',
  'emit', 'dispatchEvent',
  // Hono / Express response header API: `c.header('X-Foo', val)`.
  'header',
])

/**
 * True if `node` is an element of an array bound to a property
 * named `queryKey` / `mutationKey` / `cacheKey` (TanStack Query,
 * SWR, RTK Query). The strings in these arrays compose a
 * cache-namespace path; repeating segments across read / write
 * call sites is structural, not a refactor candidate.
 */
export function isInTanstackQueryKeyArray(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'array') return false
  const pair = parent.parent
  if (pair?.type !== 'pair') return false
  const key = pair.childForFieldName('key')
  const keyName = key?.type === 'property_identifier' ? key.text :
    (key?.type === 'string' ? key.text.replace(/^['"]|['"]$/g, '') : '')
  return keyName === 'queryKey' || keyName === 'mutationKey' ||
    keyName === 'cacheKey' || keyName === 'invalidateKeys'
}

/**
 * True if `node` is an argument of a `cn` / `clsx` / `cva` /
 * `classnames` / `twMerge` / `tw` call. These libraries expect
 * tailwind class strings as args; repeating utility tokens is
 * structural, not a refactor candidate.
 */
export function isClsxArg(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'arguments') return false
  const call = parent.parent
  if (call?.type !== 'call_expression') return false
  const fn = call.childForFieldName('function')
  let name = ''
  if (fn?.type === 'identifier') name = fn.text
  else if (fn?.type === 'member_expression') {
    name = fn.childForFieldName('property')?.text ?? ''
  }
  return name === 'cn' || name === 'clsx' || name === 'cva' ||
    name === 'classnames' || name === 'twMerge' || name === 'tw'
}

/**
 * True if `filePath` is in a known mock-fixture directory.
 * Used to skip magic-string / duplicate-string in test mocks.
 * Does NOT match bare `fixtures/` (matches the analyzer's own
 * test-fixture project at `tests/fixtures/`).
 */
export function isMockFixturePath(filePath: string): boolean {
  if (/(?:[\\/]|^)__mocks__[\\/]/.test(filePath)) return true
  if (/(?:[\\/]|^)mocks[\\/](?:handlers|server|api-)/i.test(filePath)) return true
  return false
}

/**
 * True if the switch_statement is a "dispatch table": each
 * non-default case body is at most a single dispatch
 * statement (return / throw / single call expression / break),
 * possibly empty for fall-through cases. The switch is
 * structurally equivalent to a `Map<key, value>` lookup — its
 * fan-out should not be counted as cyclomatic complexity,
 * branches, or "too many" cases. Real complexity is 1.
 *
 * Accepts:
 *  - bare fall-through cases (`case "a":` with no body, falling
 *    into the next case)
 *  - `case X: return ...;`
 *  - `case X: throw ...;`
 *  - `case X: someCall(); break;`
 *  - `case X: break;`
 *
 * Rejects any case containing nested control flow
 * (if/for/while/try/switch) or multiple non-trivial statements.
 */
export function isDispatchTableSwitch(switchNode: SyntaxNode): boolean {
  const body = switchNode.childForFieldName('body')
  if (!body) return false
  let cases = 0
  let dispatchArms = 0
  for (const c of body.namedChildren) {
    if (c.type !== 'switch_case' && c.type !== 'switch_default') continue
    cases++
    let hasDispatch = false
    let hasComplexStatement = false
    // Walk children of the case (excluding the case label).
    for (let i = 0; i < c.namedChildCount; i++) {
      const child = c.namedChild(i)
      if (!child) continue
      // The label expression is also a namedChild — skip primitives.
      if (child.type === 'string' || child.type === 'number' ||
          child.type === 'identifier' || child.type === 'member_expression' ||
          child.type === 'undefined' || child.type === 'null' ||
          child.type === 'true' || child.type === 'false' ||
          child.type === 'unary_expression' || child.type === 'template_string') continue
      if (child.type === 'return_statement') { hasDispatch = true; continue }
      if (child.type === 'throw_statement') { hasDispatch = true; continue }
      if (child.type === 'break_statement') continue
      if (child.type === 'expression_statement') {
        // A single function call (`doX()`) is a dispatch result.
        const expr = child.namedChild(0)
        if (expr?.type === 'call_expression' || expr?.type === 'await_expression' ||
            expr?.type === 'assignment_expression' || expr?.type === 'update_expression') {
          hasDispatch = true
          continue
        }
        hasComplexStatement = true
        continue
      }
      // if_statement, for_statement, while_statement, try_statement,
      // switch_statement (nested), variable_declaration: real logic.
      hasComplexStatement = true
    }
    if (hasComplexStatement) return false
    if (hasDispatch) dispatchArms++
  }
  // Need ≥4 cases AND at least one of them must be a real dispatch
  // arm (the rest can be fall-throughs).
  return cases >= 4 && dispatchArms >= 1
}

/**
 * SQL query-builder methods (Kysely, Knex, Drizzle, Prisma
 * `$kysely`) that take string literals as table/column/SQL
 * function names. Repeating these strings across builder
 * chains is structural — the strings are SQL identifiers
 * required by the API and often type-bound to the schema.
 */
const SQL_BUILDER_METHODS = new Set([
  'selectFrom', 'from', 'into', 'with',
  'select', 'distinct', 'distinctOn',
  'where', 'whereIn', 'whereNotIn', 'whereRef', 'whereExists',
  'andWhere', 'orWhere', 'having',
  'innerJoin', 'leftJoin', 'rightJoin', 'crossJoin',
  'fullJoin', 'outerJoin', 'join',
  'groupBy', 'orderBy',
  'lit', 'fn',
  'returning', 'on', 'onConflict', 'onDuplicate',
  'as',
])

/**
 * True if `node` is a string-literal argument to a SQL
 * query-builder method, either as a direct argument or as an
 * element inside an array argument: `fn('DATE_TRUNC', [..., 'col'])`.
 */
export function isInSqlBuilderCall(node: SyntaxNode): boolean {
  // Direct arg: string -> arguments -> call_expression
  let argsContainer = node.parent
  // Array element: string -> array -> arguments -> call_expression
  if (argsContainer?.type === 'array') argsContainer = argsContainer.parent
  if (argsContainer?.type !== 'arguments') return false
  const call = argsContainer.parent
  if (call?.type !== 'call_expression') return false
  const fn = call.childForFieldName('function')
  if (!fn) return false
  let name = ''
  if (fn.type === 'identifier') name = fn.text
  else if (fn.type === 'member_expression') {
    name = fn.childForFieldName('property')?.text ?? ''
  }
  return SQL_BUILDER_METHODS.has(name)
}

/**
 * True if `node` is the first argument of a method call whose
 * method name is a known field-key accessor (form / storage /
 * translation libs).
 */
export function isFieldKeyArgument(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent) return false
  if (parent.type !== 'arguments') return false
  if (parent.namedChildren[0]?.id !== node.id) return false
  const call = parent.parent
  if (call?.type !== 'call_expression') return false
  const fn = call.childForFieldName('function')
  if (!fn) return false
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property')
    if (prop && FIELD_KEY_METHODS.has(prop.text)) return true
  }
  if (fn.type === 'identifier' && FIELD_KEY_METHODS.has(fn.text)) return true
  return false
}

/**
 * True if `node` is the index of a computed-property subscript:
 * `obj['key']`.
 */
export function isSubscriptIndex(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'subscript_expression') return false
  const idx = parent.childForFieldName('index')
  return idx?.id === node.id
}

/**
 * Function names whose return-type contract is fixed by a
 * framework / runtime. Adding `: T` annotations on these adds
 * noise without strengthening any API surface — the framework
 * already enforces the type at the call boundary.
 *
 * Includes:
 *  - Next.js App Router conventions (`Page`, `Layout`, `Loading`,
 *    `NotFound`, `Error`, `Template`, `generateMetadata`,
 *    `generateStaticParams`, `generateViewport`, `revalidate`).
 *  - HTTP route-handler exports (`GET`, `POST`, `PUT`, `DELETE`,
 *    `PATCH`, `HEAD`, `OPTIONS`).
 *  - Remix conventions (`loader`, `action`, `meta`, `links`,
 *    `headers`, `clientLoader`, `clientAction`,
 *    `shouldRevalidate`, `ErrorBoundary`).
 *  - Common framework hooks / handlers (`middleware`, `default`).
 */
export const FRAMEWORK_FUNCTION_NAMES = new Set([
  // Next.js App Router
  'Page', 'Layout', 'Loading', 'NotFound', 'Error', 'Template',
  'generateMetadata', 'generateStaticParams', 'generateViewport',
  'revalidate',
  // HTTP method handlers
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
  // Remix conventions
  'loader', 'action', 'meta', 'links', 'headers',
  'clientLoader', 'clientAction', 'shouldRevalidate',
  'ErrorBoundary', 'HydrateFallback', 'Component',
  // Generic framework names
  'middleware',
])

/**
 * True if `name` looks like a React component — PascalCase
 * identifier. The convention `function MyButton()` returning
 * JSX is universally recognized; explicit return types on
 * components are rarely written and add little value beyond
 * the JSX inference TypeScript already does.
 */
export function isReactComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name)
}

/**
 * True if `name` looks like a React custom hook — `use` prefix
 * followed by an uppercase letter (`useUserPrefs`,
 * `useDebouncedValue`). Custom hooks return inferred objects
 * (often from `useMutation` / `useQuery` calls); explicit
 * annotations duplicate the inference and break when the
 * underlying lib types change.
 */
export function isReactCustomHookName(name: string): boolean {
  return /^use[A-Z]/.test(name)
}

/**
 * True if `name` is a framework-convention function — its
 * return-type contract is fixed by the runtime / framework.
 */
export function isFrameworkFunctionName(name: string): boolean {
  return FRAMEWORK_FUNCTION_NAMES.has(name)
}

/**
 * Property names whose string value is conventionally a
 * design-token / state-machine key — `variant`, `size`,
 * `intent`, `severity`, `status`, `tone`, `appearance`,
 * `state`. Repeating `'default'` / `'destructive'` /
 * `'success'` across these property values is not a refactor
 * candidate; the value is type-bound via the receiving
 * component's prop type union.
 */
const DESIGN_TOKEN_PROPERTY_NAMES = new Set([
  'variant', 'size', 'intent', 'tone', 'appearance',
  'severity', 'status', 'state', 'kind', 'type',
])

/**
 * True if `node` is the value of a key/value pair whose key is a
 * well-known design-token property name. Tree-sitter JS
 * represents `{ variant: 'default' }` as a `pair` node with key
 * + value fields.
 */
export function isDesignTokenValue(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'pair') return false
  const key = parent.childForFieldName('key')
  if (!key) return false
  const keyText = key.type === 'property_identifier' ? key.text :
    (key.type === 'string' ? key.text.replace(/^['"]|['"]$/g, '') : key.text)
  return DESIGN_TOKEN_PROPERTY_NAMES.has(keyText)
}

/**
 * True if `node` is the first argument of `useState<X>(...)`,
 * `useReducer<X, ...>(...)`, or `useRef<X>(...)`. The generic
 * arg constrains the literal default's type — extracting the
 * literal to a constant either breaks narrowing or duplicates
 * the type binding.
 */
export function isReactStateInitializer(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'arguments') return false
  if (parent.namedChildren[0]?.id !== node.id) return false
  const call = parent.parent
  if (call?.type !== 'call_expression') return false
  const fn = call.childForFieldName('function')
  // `useState<X>('lit')` — function is `useState`. Generic args
  // sit between the function and arguments in tree-sitter as
  // `type_arguments`. Match by function name only (works whether
  // generic is present or not).
  if (fn?.type === 'identifier') {
    const name = fn.text
    if (name === 'useState' || name === 'useReducer' || name === 'useRef') return true
  }
  return false
}

/**
 * Common typeof-comparison string literals. The set Python's
 * `typeof` returns and that JS code constantly compares against.
 */
const TYPEOF_VALUES = new Set([
  '"string"', '"number"', '"boolean"', '"object"', '"function"',
  '"undefined"', '"symbol"', '"bigint"',
  "'string'", "'number'", "'boolean'", "'object'", "'function'",
  "'undefined'", "'symbol'", "'bigint'",
])

/**
 * True if `node` is a string that's part of a `typeof X === "Y"`
 * comparison. The literal IS a JS-runtime sentinel value, not a
 * refactor candidate.
 */
export function isTypeofComparisonString(node: SyntaxNode): boolean {
  if (!TYPEOF_VALUES.has(node.text)) return false
  const parent = node.parent
  if (parent?.type !== 'binary_expression') return false
  const left = parent.childForFieldName('left')
  const right = parent.childForFieldName('right')
  const sibling = left?.id === node.id ? right : left
  if (sibling?.type !== 'unary_expression') return false
  // unary_expression with operator `typeof`
  for (let i = 0; i < sibling.childCount; i++) {
    const c = sibling.child(i)
    if (c?.type === 'typeof' || c?.text === 'typeof') return true
  }
  return false
}

/**
 * True if the string content looks like a CSS class list:
 * multiple space-separated tokens, each containing only word
 * characters and dashes/colons/slashes (matches Tailwind utility
 * names like `flex h-full w-1/2 text-sm`). Single-class strings
 * (e.g. `"flex"`) aren't matched — those are too short to be
 * unambiguously CSS classes.
 */
export function looksLikeCssClassList(node: SyntaxNode): boolean {
  if (node.type !== 'string') return false
  const inner = node.text.slice(1, -1)
  if (!/\s/.test(inner)) return false
  // Each whitespace-delimited token must look like a CSS utility.
  const tokens = inner.trim().split(/\s+/)
  if (tokens.length < 2) return false
  return tokens.every((t) => /^[!@-]?[\w/:[\]%.\-]+$/.test(t))
}

/**
 * True if `node` is a member of an array passed to a `.enum(...)`
 * call (Zod-style enum).
 */
export function isInZodEnumArray(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'array') return false
  let cursor: SyntaxNode | null = parent.parent
  while (cursor && (cursor.type === 'as_expression' || cursor.type === 'parenthesized_expression' || cursor.type === 'satisfies_expression')) {
    cursor = cursor.parent
  }
  if (cursor?.type !== 'arguments') return false
  const call = cursor.parent
  if (call?.type !== 'call_expression') return false
  const fn = call.childForFieldName('function')
  if (fn?.type !== 'member_expression') return false
  const prop = fn.childForFieldName('property')
  return prop?.text === 'enum'
}
