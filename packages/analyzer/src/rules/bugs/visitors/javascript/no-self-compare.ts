import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const noSelfCompareVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-self-compare',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.text === '===' || c.text === '!==' || c.text === '==' || c.text === '!=')

    if (!left || !right || !operator) return null

    // NaN === NaN or NaN == NaN
    if (left.text === 'NaN' && right.text === 'NaN') {
      const alwaysResult = operator.text === '===' || operator.text === '==' ? 'always false' : 'always true'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'NaN self-comparison',
        `\`NaN ${operator.text} NaN\` is ${alwaysResult}. Use Number.isNaN() instead.`,
        sourceCode,
        'Use Number.isNaN(value) to check for NaN.',
      )
    }

    // x !== x pattern (NaN check idiom)
    if (left.text === right.text && left.type === right.type && (operator.text === '!==' || operator.text === '!=')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'NaN self-comparison',
        `\`${left.text} ${operator.text} ${right.text}\` is a NaN check. Use Number.isNaN(${left.text}) for clarity.`,
        sourceCode,
        `Replace with Number.isNaN(${left.text}).`,
      )
    }

    return null
  },
}
