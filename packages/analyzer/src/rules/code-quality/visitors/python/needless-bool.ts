import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNeedlessBoolVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/needless-bool',
  languages: ['python'],
  nodeTypes: ['return_statement'],
  visit(node, filePath, sourceCode) {
    // return True if x else False  or  return False if x else True
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'conditional_expression') return null

    const trueVal = expr.namedChildren[0]
    const condition = expr.namedChildren[1]
    const falseVal = expr.namedChildren[2]

    if (!condition || !trueVal || !falseVal) return null

    const isTrueFalse = trueVal.text === 'True' && falseVal.text === 'False'
    const isFalseTrue = trueVal.text === 'False' && falseVal.text === 'True'

    if (isTrueFalse) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Needless boolean conversion',
        `\`return True if ${condition.text} else False\` can be simplified to \`return bool(${condition.text})\` or \`return ${condition.text}\`.`,
        sourceCode,
        `Replace with \`return ${condition.text}\` (or \`return bool(${condition.text})\` for explicit conversion).`,
      )
    }
    if (isFalseTrue) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Needless boolean conversion',
        `\`return False if ${condition.text} else True\` can be simplified to \`return not ${condition.text}\`.`,
        sourceCode,
        `Replace with \`return not ${condition.text}\`.`,
      )
    }
    return null
  },
}
