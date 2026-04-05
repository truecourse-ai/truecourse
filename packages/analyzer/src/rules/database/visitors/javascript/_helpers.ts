import type { SyntaxNode } from 'tree-sitter'

export const LOOP_TYPES = new Set([
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
])

export function isInsideLoop(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (LOOP_TYPES.has(current.type)) return true
    // Stop at function boundaries
    if (
      current.type === 'function_declaration' ||
      current.type === 'arrow_function' ||
      current.type === 'method_definition' ||
      current.type === 'function'
    ) {
      return false
    }
    current = current.parent
  }
  return false
}

/** Check if a node is directly inside a try statement body (not a catch/finally). */
export function isInsideTryBody(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'try_statement') {
      // Check if the node is in the 'body' clause, not handler/finalizer
      const body = current.childForFieldName('body')
      if (body && isDescendantOf(node, body)) return true
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

/** Get method name from call_expression. */
export function getMethodName(node: SyntaxNode): string {
  const fn = node.childForFieldName('function')
  if (!fn) return ''
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property')
    return prop?.text ?? ''
  }
  if (fn.type === 'identifier') return fn.text
  return ''
}

/** Get the full call chain text, e.g. "db.connect" */
export function getCallText(node: SyntaxNode): string {
  const fn = node.childForFieldName('function')
  return fn?.text ?? ''
}

// DB connection method names
export const CONNECTION_ACQUIRE_METHODS = new Set([
  'connect', 'getConnection', 'acquire', 'checkout', 'getClient',
])

export const CONNECTION_RELEASE_METHODS = new Set([
  'release', 'end', 'destroy', 'close', 'disconnect',
])

// ORM relationship accessor patterns — property names often accessed on ORM models
export const ORM_RELATIONSHIP_ACCESSORS = new Set([
  'related', 'load', 'fetch', 'all', 'filter', 'get', 'first', 'toArray',
])

// DB connection method names
export const SQL_WRITE_METHODS = new Set([
  'query', 'execute', 'exec', 'raw', 'rawQuery', '$queryRaw', '$executeRaw', 'run',
])

export const ORM_WRITE_METHODS = new Set([
  'create', 'insert', 'update', 'delete', 'destroy', 'save', 'upsert',
  'createMany', 'updateMany', 'deleteMany',
])

export const FIND_ONE_METHODS = new Set([
  'findOne', 'findUnique', 'findFirst', 'findByPk', 'findBy',
  'exists', 'count',
])

/**
 * Find ancestor function body (statement_block / block).
 */
export function getEnclosingFunctionBody(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (
      current.type === 'statement_block' &&
      (
        current.parent?.type === 'function_declaration' ||
        current.parent?.type === 'arrow_function' ||
        current.parent?.type === 'function' ||
        current.parent?.type === 'method_definition'
      )
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

export function bodyHasTransactionCall(body: SyntaxNode): boolean {
  const text = body.text.toLowerCase()
  return (
    /\b(transaction|begintransaction|begin_transaction|withTransaction|begin\(\))\b/.test(text)
  )
}
