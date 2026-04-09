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

    // If the type is `any` or `unknown`, we can't determine if it's a Promise — skip.
    // Both are compatible with PromiseLike, so flagging them would be a false positive.
    const isAny = typeQuery.isAnyType(
      filePath,
      awaitedExpr.startPosition.row,
      awaitedExpr.startPosition.column,
      awaitedExpr.endPosition.row,
      awaitedExpr.endPosition.column,
    )
    if (isAny) return null

    // Also skip `unknown` — it's not provably non-thenable
    const typeStr = typeQuery.getTypeAtPosition(
      filePath,
      awaitedExpr.startPosition.row,
      awaitedExpr.startPosition.column,
      awaitedExpr.endPosition.row,
      awaitedExpr.endPosition.column,
    )
    if (!typeStr || typeStr === 'unknown') return null

    const isPromise = typeQuery.isPromiseLike(
      filePath,
      awaitedExpr.startPosition.row,
      awaitedExpr.startPosition.column,
      awaitedExpr.endPosition.row,
      awaitedExpr.endPosition.column,
    )
    // Skip ALL await expressions where the awaited value is a call_expression on a
    // member_expression. These are method calls whose return type we can't reliably
    // determine from static analysis (e.g., LangChain .invoke(), Prisma .findMany(), etc.)
    if (awaitedExpr.type === 'call_expression') {
      const fn = awaitedExpr.childForFieldName('function')
      if (fn?.type === 'member_expression') return null
    }

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
