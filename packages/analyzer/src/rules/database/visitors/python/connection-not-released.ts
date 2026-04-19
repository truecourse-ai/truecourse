import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_CONNECTION_METHODS, isInsideTryBody } from './_helpers.js'

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

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Database connection not released',
      `${methodName}() acquires a connection but it may not be released on error. Use a context manager (with statement) or try/finally to guarantee the connection is released.`,
      sourceCode,
      'Use `with connection:` or a try/finally block to ensure the connection is always released.',
    )
  },
}
