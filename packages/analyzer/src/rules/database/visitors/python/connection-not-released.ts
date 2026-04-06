import type { SyntaxNode } from 'tree-sitter'
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
