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

    // Unwrap parenthesized_expression to get the inner expression
    while (condition && condition.type === 'parenthesized_expression' && condition.namedChildren.length > 0) {
      condition = condition.namedChildren[0]
    }
    if (!condition) return null

    // Skip if the condition is an await expression
    if (condition.type === 'await_expression') return null

    // Skip ref-truthy checks: \`if (someRef.current) { ... }\`. The
    // ref may hold a Promise, but the truthy check is asking
    // "is the ref populated?" — testing for non-null, not
    // awaiting the inner value.
    if (condition.type === 'member_expression') {
      const prop = condition.childForFieldName('property')
      if (prop?.text === 'current') return null
    }
    // Skip when the condition's type is a union of Promise|null
    // / Promise|undefined — the user is testing for "ref/cache
    // populated?" rather than "promise resolved?".
    {
      const t = typeQuery.getTypeAtPosition(
        filePath,
        condition.startPosition.row, condition.startPosition.column,
        condition.endPosition.row, condition.endPosition.column,
      )
      if (t && /Promise<.*>/.test(t) && /\|/.test(t) && /\b(?:null|undefined)\b/.test(t)) return null
    }

    const isPromise = typeQuery.isPromiseLike(
      filePath,
      condition.startPosition.row,
      condition.startPosition.column,
      condition.endPosition.row,
      condition.endPosition.column,
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
