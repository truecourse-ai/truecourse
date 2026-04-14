import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const jsUselessCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-catch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const statements = body.namedChildren
    if (statements.length !== 1) return null

    const stmt = statements[0]
    if (stmt.type !== 'throw_statement') return null

    const throwExpr = stmt.namedChildren[0]
    if (!throwExpr) return null

    // Get the catch parameter name
    const param = node.childForFieldName('parameter')
    if (!param) return null

    const paramName = param.text.replace(/[^a-zA-Z0-9_$]/g, '')
    if (throwExpr.text !== paramName) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Useless catch clause',
      'This catch clause only re-throws the caught exception without adding context. Remove it or add error handling logic.',
      sourceCode,
      'Remove the try/catch wrapper or add meaningful error handling in the catch block.',
    )
  },
}
