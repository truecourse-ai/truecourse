import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, ORM_WRITE_METHODS, getEnclosingFunctionBody } from './_helpers.js'

const FIND_ONE_METHODS = new Set([
  'findOne', 'findUnique', 'findFirst', 'findByPk', 'findBy',
  'exists', 'count',
])

export const missingUniqueConstraintVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-unique-constraint',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!FIND_ONE_METHODS.has(methodName)) return null

    // The find call must be inside an if-statement condition or if body
    let current: SyntaxNode | null = node.parent
    let inIfCondition = false
    while (current) {
      if (current.type === 'if_statement') {
        inIfCondition = true
        break
      }
      // Stop at function boundaries
      if (
        current.type === 'function_declaration' ||
        current.type === 'arrow_function' ||
        current.type === 'function' ||
        current.type === 'method_definition'
      ) {
        break
      }
      current = current.parent
    }

    if (!inIfCondition) return null

    // Check if the enclosing function body also has a create/insert call
    const body = getEnclosingFunctionBody(node)
    if (!body) return null

    const bodyText = body.text
    const ormWriteArr = Array.from(ORM_WRITE_METHODS)
    const hasWriteAfterCheck = ormWriteArr.some((m) => bodyText.includes(`.${m}(`))

    if (!hasWriteAfterCheck) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Uniqueness enforced only in application code',
      `${methodName}() used to check uniqueness before a write, but without a corresponding UNIQUE constraint in the database schema. Under concurrent requests, duplicate records can still be created due to race conditions.`,
      sourceCode,
      'Add a UNIQUE constraint to the database column and handle the constraint violation error instead of pre-checking.',
    )
  },
}
