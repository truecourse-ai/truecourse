import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Promise-returning expression statement without await, .catch(), or void.
 * Corresponds to @typescript-eslint/no-floating-promises.
 */
export const unhandledPromiseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unhandled-promise',
  languages: TS_LANGUAGES,
  nodeTypes: ['expression_statement'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null
    const expr = node.namedChildren[0]
    if (!expr) return null

    // Skip if already handled: void expr, expr.catch(), await expr
    if (expr.type === 'await_expression') return null
    if (expr.type === 'void_expression') return null
    if (expr.type === 'call_expression') {
      const fn = expr.childForFieldName('function')
      if (fn?.type === 'member_expression') {
        const prop = fn.childForFieldName('property')
        if (prop?.text === 'catch' || prop?.text === 'then') return null
      }
    }

    const isPromise = typeQuery.isPromiseLike(
      filePath,
      expr.startPosition.row,
      expr.startPosition.column,
    )
    if (isPromise) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unhandled promise',
        'Promise-returning expression used as a statement without `await`, `.catch()`, or `void` — rejection will be silently lost.',
        sourceCode,
        'Add `await` before the expression, chain `.catch()`, or prefix with `void` if intentional.',
      )
    }
    return null
  },
}
