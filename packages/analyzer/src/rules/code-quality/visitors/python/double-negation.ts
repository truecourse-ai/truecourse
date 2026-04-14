import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDoubleNegationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/double-negation',
  languages: ['python'],
  nodeTypes: ['not_operator'],
  visit(node, filePath, sourceCode) {
    // not not x
    const operand = node.namedChildren[0]
    if (!operand || operand.type !== 'not_operator') return null

    const inner = operand.namedChildren[0]
    const innerText = inner?.text || 'x'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Double negation',
      `\`not not ${innerText}\` can be simplified to \`bool(${innerText})\`.`,
      sourceCode,
      `Replace \`not not ${innerText}\` with \`bool(${innerText})\`.`,
    )
  },
}
