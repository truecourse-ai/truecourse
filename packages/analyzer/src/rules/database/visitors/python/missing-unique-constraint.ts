import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_FIND_METHODS, PYTHON_WRITE_METHODS, getPythonEnclosingFunctionBody } from './_helpers.js'

export const pythonMissingUniqueConstraintVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-unique-constraint',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const methodName = getPythonMethodName(node)
    if (!PYTHON_FIND_METHODS.has(methodName)) return null

    // Must be inside an if-statement
    let current: SyntaxNode | null = node.parent
    let inIfCondition = false
    while (current) {
      if (current.type === 'if_statement') {
        inIfCondition = true
        break
      }
      if (current.type === 'function_definition') break
      current = current.parent
    }

    if (!inIfCondition) return null

    // Check if the enclosing function also has a write call
    const body = getPythonEnclosingFunctionBody(node)
    if (!body) return null

    const bodyText = body.text
    const hasWriteAfterCheck = Array.from(PYTHON_WRITE_METHODS).some((m) => bodyText.includes(`.${m}(`))
    if (!hasWriteAfterCheck) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Uniqueness enforced only in application code',
      `${methodName}() used to check uniqueness before a write, but without a UNIQUE constraint in the database schema. Under concurrent requests, duplicate records can still be created.`,
      sourceCode,
      'Add a UNIQUE constraint to the database column and handle the IntegrityError instead of pre-checking.',
    )
  },
}
