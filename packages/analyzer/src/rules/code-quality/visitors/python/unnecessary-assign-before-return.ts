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

    // Skip when the RHS is an `await` expression. Naming the
    // awaited result is conventional in async pipelines for
    // stack-trace clarity; collapsing to `return await x`
    // works but the inline-assignment form is widely accepted
    // and not a refactor worth surfacing.
    if (rhs.type === 'await') return null

    // Skip when the RHS is a `cast(T, …)` — the named-result
    // pattern is conventional for documenting the post-cast
    // type at the return site.
    if (rhs.type === 'call') {
      const fn = rhs.childForFieldName('function')
      if (fn?.type === 'identifier' && fn.text === 'cast') return null
    }

    // Skip annotated assignments (`x: int = compute(); return x`).
    // The annotation has documentation / type-refinement value
    // that's lost when collapsed to `return compute()`.
    if (prevExpr.childForFieldName('type')) return null

    return makeViolation(
      this.ruleKey, prev, filePath, 'low',
      'Unnecessary assignment before return',
      `Variable \`${assignedVar.text}\` is assigned only to be immediately returned — return the expression directly.`,
      sourceCode,
      `Replace with: \`return ${rhs.text}\``,
    )
  },
}
