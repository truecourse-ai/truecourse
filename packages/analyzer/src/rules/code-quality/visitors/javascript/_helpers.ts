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
])

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
