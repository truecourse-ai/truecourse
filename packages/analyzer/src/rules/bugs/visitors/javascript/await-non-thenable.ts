import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: awaiting a value that is not a Promise or Thenable.
 * Requires TypeQueryService to check whether the awaited expression is Promise-like.
 */
export const awaitNonThenableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/await-non-thenable',
  languages: TS_LANGUAGES,
  nodeTypes: ['await_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null
    const awaitedExpr = node.namedChildren[0]
    if (!awaitedExpr) return null

    const isPromise = typeQuery.isPromiseLike(
      filePath,
      awaitedExpr.startPosition.row,
      awaitedExpr.startPosition.column,
    )
    if (!isPromise) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Awaiting non-thenable value',
        `\`await\` used on an expression that is not a Promise or Thenable — the \`await\` has no effect.`,
        sourceCode,
        'Remove the `await` keyword since this expression is not a Promise.',
      )
    }
    return null
  },
}
