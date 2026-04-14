import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const catchRethrowNoContextVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/catch-rethrow-no-context',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const param = node.childForFieldName('parameter')
    if (!param) return null

    const paramName = param.text.replace(/:.+/, '').trim()
    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if the body is just "throw <param>" with no wrapping
    const statements = body.namedChildren
    if (statements.length !== 1) return null

    const stmt = statements[0]
    if (stmt.type !== 'throw_statement') return null

    const thrown = stmt.namedChildren[0]
    if (!thrown) return null

    // If re-throwing the same error variable without wrapping
    if (thrown.type === 'identifier' && thrown.text === paramName) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Catch rethrows without adding context',
        `Catch block rethrows '${paramName}' without adding context. Either remove the try/catch or wrap the error.`,
        sourceCode,
        `Wrap the error: throw new Error('Context: ...', { cause: ${paramName} });`,
      )
    }

    return null
  },
}
