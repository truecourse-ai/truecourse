import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const strictEqualityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/strict-equality',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '==' || c.type === '!=')
    if (!op) return null

    // Skip `== null` / `!= null` — this is idiomatic JS/TS for checking both null and undefined
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (left?.type === 'null' || right?.type === 'null') return null

    const opText = op.text
    const strict = opText === '==' ? '===' : '!=='

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Loose equality operator',
      `Using \`${opText}\` performs type coercion. Use \`${strict}\` for predictable comparisons.`,
      sourceCode,
      `Replace \`${opText}\` with \`${strict}\`.`,
    )
  },
}
