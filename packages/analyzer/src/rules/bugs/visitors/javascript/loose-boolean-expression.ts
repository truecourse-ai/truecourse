import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Non-boolean values in boolean contexts (if, while, &&, ||, !, ternary).
 * Corresponds to @typescript-eslint/strict-boolean-expressions.
 *
 * Flags when a non-boolean value is used as a condition, which can lead to
 * subtle bugs with falsy values (0, '', null, undefined).
 */
export const looseBooleanExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/loose-boolean-expression',
  languages: TS_LANGUAGES,
  nodeTypes: ['if_statement', 'while_statement', 'do_statement'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const condition = node.childForFieldName('condition')
    if (!condition) return null

    // Skip parenthesized_expression — get inner
    let expr = condition
    if (expr.type === 'parenthesized_expression' && expr.namedChildren[0]) {
      expr = expr.namedChildren[0]
    }

    // Skip already-boolean expressions (comparisons, logical ops, negation)
    if (expr.type === 'binary_expression') {
      const op = expr.children.find(c =>
        ['===', '!==', '==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(c.text),
      )
      if (op) return null
    }
    if (expr.type === 'unary_expression' && expr.children[0]?.text === '!') return null

    const isBoolean = typeQuery.isBooleanType(
      filePath,
      expr.startPosition.row,
      expr.startPosition.column,
      expr.endPosition.row,
      expr.endPosition.column,
    )
    if (!isBoolean) {
      const typeStr = typeQuery.getTypeAtPosition(
        filePath,
        expr.startPosition.row,
        expr.startPosition.column,
        expr.endPosition.row,
        expr.endPosition.column,
      )
      // Skip if type is unknown or any
      if (!typeStr || typeStr === 'any' || typeStr === 'unknown') return null
      // Skip if it's already a boolean literal type
      if (typeStr === 'true' || typeStr === 'false') return null
      // Skip object/array/function types — they can never be falsy (only null/undefined)
      // so truthiness checks on them are always safe
      if (typeStr.startsWith('{') || typeStr.endsWith('[]') || typeStr.startsWith('(')
        || typeStr.includes('=>') || typeStr.includes('class ')) return null
      // Skip when the type is a class/interface instance (starts with uppercase, not a primitive)
      // These are objects that can only be truthy or null/undefined
      const baseType = typeStr.replace(/\s*\|.*/, '') // first type in union
      if (/^[A-Z]/.test(baseType) && !['Number', 'String', 'Boolean'].includes(baseType)) return null

      // Only fire when a *falsy literal* sits inside the union — that's
      // the case where the truthy check silently collapses a meaningful
      // value (the empty string, `0`, `0n`) with the "missing" reading
      // the rest of the union represents. `if (value)` on `string`,
      // `number`, `boolean`, or any `T | null | undefined` of those is
      // the idiomatic null-or-empty guard; the @typescript-eslint
      // strict-boolean-expressions stricter reading floods FPs with no
      // observed bug payoff.
      const parts = typeStr.split('|').map(p => p.trim())
      const FALSY_LITERAL = /^(?:""|''|0|0n)$/
      if (!parts.some(p => FALSY_LITERAL.test(p))) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Non-boolean in boolean context',
        `Expression of type \`${typeStr}\` used as condition — implicit boolean coercion can cause subtle bugs with falsy values (0, "", null).`,
        sourceCode,
        'Use an explicit comparison, e.g., `!== null`, `!== undefined`, `!== 0`, or `!== ""`.',
      )
    }

    return null
  },
}
