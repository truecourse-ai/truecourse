import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const compareNegZeroVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/compare-neg-zero',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => ['===', '==', '!==', '!='].includes(c.text))

    if (!left || !right || !operator) return null

    function isNegZero(n: SyntaxNode): boolean {
      if (n.type === 'unary_expression') {
        const op = n.children.find((c) => c.text === '-')
        const operand = n.childForFieldName('argument')
        return !!op && !!operand && operand.text === '0'
      }
      return false
    }

    if (isNegZero(left) || isNegZero(right)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Comparison with -0',
        '`=== -0` is unreliable because `-0 === 0` is true. Use `Object.is(x, -0)` instead.',
        sourceCode,
        'Replace with Object.is(x, -0) for a reliable negative zero check.',
      )
    }
    return null
  },
}
