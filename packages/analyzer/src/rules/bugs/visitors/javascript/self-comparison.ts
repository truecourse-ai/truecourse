import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { COMPARISON_OPERATORS, JS_LANGUAGES } from './_helpers.js'

export const selfComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/self-comparison',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => COMPARISON_OPERATORS.has(c.text))

    if (!left || !right || !operator) return null
    if (!COMPARISON_OPERATORS.has(operator.text)) return null

    if (left.text === right.text && left.type === right.type) {
      // Skip NaN checks — those are handled by no-self-compare
      if (left.text === 'NaN') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Self comparison',
        `Comparing \`${left.text}\` to itself is always ${operator.text === '!==' || operator.text === '!=' || operator.text === '>' || operator.text === '<' ? 'false' : 'true'} — likely a bug.`,
        sourceCode,
        'Compare against a different value, or remove this comparison.',
      )
    }
    return null
  },
}
