import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Promise used in boolean context without await (if, while, ternary, &&, ||).
 * Corresponds to @typescript-eslint/no-misused-promises.
 */
export const misusedPromiseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/misused-promise',
  languages: TS_LANGUAGES,
  nodeTypes: ['if_statement', 'while_statement', 'do_statement', 'for_statement', 'ternary_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    let condition: typeof node | null = null
    if (node.type === 'ternary_expression') {
      condition = node.namedChildren[0] ?? null
    } else {
      condition = node.childForFieldName('condition')
    }
    if (!condition) return null

    // Skip if the condition is an await expression
    if (condition.type === 'await_expression') return null

    const isPromise = typeQuery.isPromiseLike(
      filePath,
      condition.startPosition.row,
      condition.startPosition.column,
    )
    if (isPromise) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Promise used in conditional without await',
        'A Promise is used in a boolean context — Promises are always truthy, so this condition will always pass. Add `await` to check the resolved value.',
        sourceCode,
        'Add `await` before the Promise expression in the condition.',
      )
    }
    return null
  },
}
