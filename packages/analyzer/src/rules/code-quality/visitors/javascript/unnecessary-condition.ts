import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Conditional check on a value whose type makes it always truthy or always falsy.
 * Corresponds to @typescript-eslint/no-unnecessary-condition.
 */
export const unnecessaryConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-condition',
  languages: TS_LANGUAGES,
  nodeTypes: ['if_statement', 'ternary_expression'],
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

    // Unwrap parentheses
    let expr = condition
    if (expr.type === 'parenthesized_expression' && expr.namedChildren[0]) {
      expr = expr.namedChildren[0]
    }

    // Skip if it's already a comparison or logical expression
    if (expr.type === 'binary_expression' || expr.type === 'unary_expression') return null

    const typeStr = typeQuery.getTypeAtPosition(
      filePath,
      expr.startPosition.row,
      expr.startPosition.column,
    )
    if (!typeStr) return null

    // Skip any/unknown
    if (typeStr === 'any' || typeStr === 'unknown') return null

    // Always truthy types
    const alwaysTruthy = new Set(['object', 'Function', 'symbol', 'RegExp'])
    if (typeStr === 'true' || alwaysTruthy.has(typeStr)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Condition is always truthy',
        `Condition of type \`${typeStr}\` is always truthy — this check is unnecessary.`,
        sourceCode,
        'Remove the condition or simplify the code.',
      )
    }

    // Always falsy types
    if (typeStr === 'false' || typeStr === 'never' || typeStr === 'void') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Condition is always falsy',
        `Condition of type \`${typeStr}\` is always falsy — the code inside will never execute.`,
        sourceCode,
        'Remove the dead code or fix the condition.',
      )
    }

    return null
  },
}
