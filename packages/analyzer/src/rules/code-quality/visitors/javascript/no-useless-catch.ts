import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noUselessCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-useless-catch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const paramNode = node.childForFieldName('parameter')
    const bodyNode = node.childForFieldName('body')
    if (!paramNode || !bodyNode) return null

    const stmts = bodyNode.namedChildren
    if (stmts.length !== 1) return null
    const stmt = stmts[0]
    if (stmt.type !== 'throw_statement') return null

    const thrownExpr = stmt.namedChildren[0]
    if (!thrownExpr) return null

    const paramName = paramNode.text
    if (thrownExpr.type === 'identifier' && thrownExpr.text === paramName) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Useless catch clause',
        `catch(${paramName}) only re-throws the error. Remove the try/catch or add error handling/context.`,
        sourceCode,
        'Remove the try/catch block, or add error handling, logging, or wrapping before re-throwing.',
      )
    }
    return null
  },
}
