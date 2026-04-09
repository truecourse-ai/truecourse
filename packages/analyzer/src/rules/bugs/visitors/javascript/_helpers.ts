import type { SyntaxNode } from 'tree-sitter'

export const JS_LANGUAGES: ('typescript' | 'tsx' | 'javascript')[] = ['typescript', 'tsx', 'javascript']

export const TS_LANGUAGES: ('typescript' | 'tsx')[] = ['typescript', 'tsx']

export const COMPARISON_OPERATORS = new Set(['===', '==', '!==', '!=', '>', '<', '>=', '<='])

export const CONSTANT_LITERALS = new Set(['true', 'false', 'null', 'undefined'])

export const TERMINAL_TYPES = new Set(['return_statement', 'throw_statement', 'break_statement', 'continue_statement'])

export const VALID_TYPEOF_VALUES = new Set([
  'undefined', 'object', 'boolean', 'number', 'string', 'function', 'symbol', 'bigint',
])

export const CASE_TERMINATORS = new Set(['break_statement', 'return_statement', 'throw_statement', 'continue_statement'])

export const LITERAL_TYPES = new Set(['string', 'number', 'true', 'false', 'null', 'undefined'])

export function isLiteralNode(n: SyntaxNode): boolean {
  return LITERAL_TYPES.has(n.type) || n.type === 'template_string'
}

export const ARRAY_METHODS_REQUIRING_RETURN = new Set([
  'map', 'filter', 'reduce', 'reduceRight', 'find', 'findIndex', 'some', 'every', 'flatMap', 'sort',
])

export const PRIMITIVE_TYPES = new Set(['number', 'string', 'true', 'false', 'null', 'undefined'])

export const PURE_ARRAY_METHODS = new Set([
  'map', 'filter', 'slice', 'concat', 'flat', 'flatMap', 'toSorted', 'toReversed',
  'join', 'keys', 'values', 'entries', 'find', 'findIndex', 'findLast', 'findLastIndex',
  'indexOf', 'lastIndexOf', 'includes', 'every', 'some', 'reduce', 'reduceRight',
])

export const KNOWN_ARG_ORDERS: Array<{ fn: string; params: string[][] }> = [
  { fn: 'startsWith', params: [['prefix', 'str', 'string', 'start', 'needle', 'search']] },
  { fn: 'endsWith', params: [['suffix', 'str', 'string', 'end', 'needle', 'search']] },
  { fn: 'includes', params: [['item', 'element', 'val', 'value', 'search', 'needle']] },
  { fn: 'indexOf', params: [['item', 'element', 'val', 'value', 'search', 'needle']] },
  { fn: 'replace', params: [['pattern', 'search', 'needle', 'from', 'old'], ['replacement', 'with', 'to', 'new', 'newVal']] },
  { fn: 'substring', params: [['start', 'from', 'begin'], ['end', 'to', 'finish']] },
]

export const VOID_RETURNING_METHODS = new Set([
  'forEach', 'push', 'pop', 'shift', 'unshift', 'splice', 'fill',
  'delete', 'clear', 'set', 'add',
])

export const VOID_RETURNING_GLOBALS = new Set([
  'console.log', 'console.error', 'console.warn', 'console.info', 'console.debug',
])

export const NON_CONSTRUCTORS = new Set(['Symbol', 'BigInt', 'Math', 'JSON', 'Reflect', 'Atomics'])

export const PROTOTYPE_BUILTINS = new Set([
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
])

export const NON_CALLABLE_GLOBALS = new Set(['Math', 'JSON', 'Reflect', 'Atomics', 'Intl'])

export const READ_ONLY_GLOBALS = new Set([
  'undefined', 'NaN', 'Infinity',
  'Math', 'JSON', 'Reflect', 'Atomics', 'Intl',
  'Object', 'Array', 'Function', 'Boolean', 'Number', 'String',
  'Symbol', 'BigInt', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef',
  'Date', 'RegExp', 'ArrayBuffer', 'DataView',
])

export const RESTRICTED_NAMES = new Set(['undefined', 'NaN', 'Infinity', 'eval', 'arguments'])

export const THROWABLE_TYPES = new Set(['string', 'number', 'true', 'false', 'null', 'undefined', 'object'])

