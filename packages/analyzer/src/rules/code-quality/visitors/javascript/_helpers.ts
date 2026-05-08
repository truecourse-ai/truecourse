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
