import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const useIsNanVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/use-isnan',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => ['===', '==', '!==', '!='].includes(c.text))

    if (!left || !right || !operator) return null

    // Check if either side is NaN (but not both — that's handled by no-self-compare)
    const leftIsNaN = left.text === 'NaN'
    const rightIsNaN = right.text === 'NaN'

    if ((leftIsNaN || rightIsNaN) && !(leftIsNaN && rightIsNaN)) {
      const otherSide = leftIsNaN ? right.text : left.text
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Direct NaN comparison',
        `\`${node.text}\` is always ${operator.text === '===' || operator.text === '==' ? 'false' : 'true'}. Use \`Number.isNaN(${otherSide})\` instead.`,
        sourceCode,
        `Replace with Number.isNaN(${otherSide}).`,
      )
    }
    return null
  },
}
