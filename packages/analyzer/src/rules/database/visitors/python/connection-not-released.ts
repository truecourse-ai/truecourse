import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_CONNECTION_METHODS, isInsideTryBody } from './_helpers.js'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Factory pattern: `def _connect(): return X.connect(...)`. Resource
// ownership is transferred to the caller, who handles the lifecycle.
function isFactoryReturn(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'return_statement') return true
    if (current.type === 'expression_statement') return false
    if (current.type === 'function_definition') return false
    current = current.parent
  }
  return false
}

// Module-level cache pattern: `_DB_CONN = sqlite3.connect(...)` at the top
// level of a module, with an UPPER_CASE-constant or leading-underscore
// name. This is the standard Lambda warm-start optimisation - the
// connection's lifetime is the container's lifetime, not the function's.
// The naming convention requirement avoids matching ad-hoc module-level
// `conn = ...` snippets that should still be flagged.
function isModuleLevelCache(node: SyntaxNode): boolean {
  // Walk up to the assignment.
  let assign: SyntaxNode | null = node.parent
  while (assign) {
    if (assign.type === 'assignment') break
    if (assign.type === 'expression_statement') return false
    if (assign.type === 'function_definition') return false
    if (assign.type === 'class_definition') return false
    assign = assign.parent
  }
  if (!assign) return false
  // Module-level assignments are wrapped in an expression_statement
  // whose parent is `module`.
  const stmt = assign.parent
  if (!(stmt?.type === 'expression_statement' && stmt.parent?.type === 'module')) return false
  // Require an intentional-cache naming convention.
  const lhs = assign.childForFieldName('left')
  const nameNode = lhs?.type === 'identifier' ? lhs : null
  if (!nameNode) return false
  const name = nameNode.text
  return /^[A-Z_][A-Z0-9_]*$/.test(name) || name.startsWith('_')
}

// Object-attribute pattern: `self.conn = sqlite3.connect(...)` inside a
// leading-underscore-named class. Private classes (`_CleanupScript`,
// `_Worker`) are by convention scoped helpers with controlled lifetimes;
// long-lived public services (`JobProcessor`, `UserRepository`) leak
// connections in the same shape and stay flagged. The Python-private
// convention is the same disambiguator we use for `missing-transaction`.
function isInstanceAttributeAssignmentInPrivateClass(node: SyntaxNode): boolean {
  let assign: SyntaxNode | null = node.parent
  while (assign) {
    if (assign.type === 'assignment') break
    if (assign.type === 'expression_statement') return false
    if (assign.type === 'function_definition') return false
    assign = assign.parent
  }
  if (!assign) return false
  const lhs = assign.childForFieldName('left')
  if (lhs?.type !== 'attribute') return false
  const obj = lhs.childForFieldName('object')
  if (!(obj?.type === 'identifier' && (obj.text === 'self' || obj.text === 'cls'))) return false

  // Walk up to the enclosing class_definition and check the name.
  let cls: SyntaxNode | null = assign.parent
  while (cls) {
    if (cls.type === 'class_definition') {
      const name = cls.childForFieldName('name')
      return name?.type === 'identifier' && name.text.startsWith('_')
    }
    cls = cls.parent
  }
  return false
}

// Try/finally release pattern:
//
//   conn = psycopg2.connect(...)
//   try:
//       ...
//   finally:
//       conn.close()
//
// `isInsideTryBody` returns false here because the connect() is *above*
// the try block, but the connection IS released. Detect this by walking
// the enclosing function body for a try_statement whose finally clause
// references `<varName>.close()` (or .dispose() / .release()).
function isClosedInFinally(node: SyntaxNode): boolean {
  // The call must be the RHS of an assignment: `conn = X.connect(...)`.
  let assignmentParent: SyntaxNode | null = node.parent
  while (assignmentParent) {
    if (assignmentParent.type === 'assignment') break
    if (assignmentParent.type === 'expression_statement') return false
    if (assignmentParent.type === 'function_definition') return false
    assignmentParent = assignmentParent.parent
  }
  if (!assignmentParent) return false
  const lhs = assignmentParent.childForFieldName('left')
  if (!lhs || lhs.type !== 'identifier') return false
  const varName = lhs.text

  // Find the enclosing function body.
  let func: SyntaxNode | null = assignmentParent.parent
  while (func) {
    if (func.type === 'function_definition') break
    func = func.parent
  }
  if (!func) return false
  const body = func.childForFieldName('body')
  if (!body) return false

  const closePattern = new RegExp(`\\b${escapeRegExp(varName)}\\.(?:close|dispose|release)\\s*\\(`)
  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'finally_clause' && closePattern.test(n.text)) {
      found = true
      return
    }
    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i)
      if (ch) walk(ch)
    }
  }
  walk(body)
  return found
}

export const pythonConnectionNotReleasedVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/connection-not-released',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const methodName = getPythonMethodName(node)
    if (!PYTHON_CONNECTION_METHODS.has(methodName)) return null

    // Skip lock-related .acquire() calls — Redis locks, threading locks, etc.
    // These are not database connections.
    if (methodName === 'acquire') {
      const fn = node.childForFieldName('function')
      if (fn?.type === 'attribute') {
        const receiver = fn.childForFieldName('object')
        if (receiver) {
          const recvText = receiver.text.toLowerCase()
          // self.acquire() inside a class with "lock" in the name,
          // or foo_lock.acquire(), or self._lock.acquire(), etc.
          if (recvText === 'self') {
            // Check if we're inside a class whose name suggests a lock
            let parent: SyntaxNode | null = node.parent
            while (parent) {
              if (parent.type === 'class_definition') {
                const nameNode = parent.childForFieldName('name')
                if (nameNode && /lock/i.test(nameNode.text)) return null
                break
              }
              parent = parent.parent
            }
          } else if (/lock/i.test(recvText)) {
            return null
          }
        }
      }
    }

    // If wrapped in a try block — assume finally handles release
    if (isInsideTryBody(node)) return null

    // Check for "with" statement (context manager — safe)
    let current: SyntaxNode | null = node.parent
    while (current) {
      if (current.type === 'with_statement') return null
      if (current.type === 'function_definition') break
      current = current.parent
    }

    // Connection-factory functions: `def _connect(): return X.connect(...)`
    if (isFactoryReturn(node)) return null

    // `conn = X.connect(...)` followed by `try: ... finally: conn.close()`
    if (isClosedInFinally(node)) return null

    // Lambda warm-start cache: module-level `_DB_CONN = X.connect(...)`.
    if (isModuleLevelCache(node)) return null

    // Long-lived object attribute in a leading-underscore-named class:
    // `self.conn = X.connect(...)` inside `class _CleanupScript`.
    if (isInstanceAttributeAssignmentInPrivateClass(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Database connection not released',
      `${methodName}() acquires a connection but it may not be released on error. Use a context manager (with statement) or try/finally to guarantee the connection is released.`,
      sourceCode,
      'Use `with connection:` or a try/finally block to ensure the connection is always released.',
    )
  },
}
