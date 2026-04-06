import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryAssignBeforeReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-assign-before-return',
  languages: ['python'],
  nodeTypes: ['block'],
  visit(node, filePath, sourceCode) {
    const stmts = node.namedChildren
    if (stmts.length < 2) return null

    const last = stmts[stmts.length - 1]
    const prev = stmts[stmts.length - 2]

    // Last must be return_statement
    if (last.type !== 'return_statement') return null

    // Previous must be assignment
    if (prev.type !== 'expression_statement') return null
    const prevExpr = prev.namedChildren[0]
    if (!prevExpr || prevExpr.type !== 'assignment') return null

    const assignedVar = prevExpr.childForFieldName('left')
    if (!assignedVar || assignedVar.type !== 'identifier') return null

    // Return must reference the assigned variable exactly
    const returnVal = last.namedChildren[0]
    if (!returnVal || returnVal.type !== 'identifier') return null

    if (assignedVar.text !== returnVal.text) return null

    const rhs = prevExpr.childForFieldName('right')
    if (!rhs) return null

    return makeViolation(
      this.ruleKey, prev, filePath, 'low',
      'Unnecessary assignment before return',
      `Variable \`${assignedVar.text}\` is assigned only to be immediately returned — return the expression directly.`,
      sourceCode,
      `Replace with: \`return ${rhs.text}\``,
    )
  },
}
