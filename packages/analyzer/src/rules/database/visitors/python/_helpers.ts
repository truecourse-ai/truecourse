import type { SyntaxNode } from 'tree-sitter'

export const PYTHON_LOOP_TYPES = new Set([
  'for_statement', 'while_statement',
])

export function isInsideLoop(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (PYTHON_LOOP_TYPES.has(current.type)) return true
    // Stop at function/method boundaries
    if (current.type === 'function_definition' || current.type === 'lambda') {
      return false
    }
    current = current.parent
  }
  return false
}

export function isInsideTryBody(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'try_statement') {
      // In tree-sitter Python, the body is the first named child
      const bodyBlock = current.namedChildren[0]
      if (bodyBlock && isDescendantOf(node, bodyBlock)) return true
      return false
    }
    current = current.parent
  }
  return false
}

export function isDescendantOf(node: SyntaxNode, ancestor: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.id === ancestor.id) return true
    current = current.parent
  }
  return false
}

export function getPythonMethodName(node: SyntaxNode): string {
  const fn = node.childForFieldName('function')
  if (!fn) return ''
  if (fn.type === 'attribute') {
    const attr = fn.childForFieldName('attribute')
    return attr?.text ?? ''
  }
  if (fn.type === 'identifier') return fn.text
  return ''
}

export const PYTHON_SQL_METHODS = new Set([
  'execute', 'executemany', 'executescript', 'exec',
])

export const PYTHON_WRITE_METHODS = new Set([
  'add', 'add_all', 'merge', 'delete', 'update', 'save', 'create', 'insert',
  'bulk_create', 'bulk_update', 'filter',
])

export const PYTHON_FIND_METHODS = new Set([
  'get', 'filter', 'first', 'one', 'one_or_none', 'exists',
])

export const PYTHON_ORM_LAZY_METHODS = new Set([
  'all', 'filter', 'first', 'get', 'count', 'exists',
])

export const PYTHON_CONNECTION_METHODS = new Set([
  'connect', 'get_connection', 'acquire', 'getconn',
])

export function getPythonEnclosingFunctionBody(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'function_definition') {
      return current.childForFieldName('body') ?? null
    }
    current = current.parent
  }
  return null
}
