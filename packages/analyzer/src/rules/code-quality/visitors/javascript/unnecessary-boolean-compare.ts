import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnecessaryBooleanCompareVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-boolean-compare',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '===' || c.type === '!=='
      || c.type === '==' || c.type === '!=')
    if (!op) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const leftIsBoolean = left.text === 'true' || left.text === 'false'
    const rightIsBoolean = right.text === 'true' || right.text === 'false'

    if (!leftIsBoolean && !rightIsBoolean) return null
    if (leftIsBoolean && rightIsBoolean) return null

    const boolLiteral = leftIsBoolean ? left.text : right.text
    const opText = op.text

    // `=== false` and `!== true` may be intentional for nullable booleans (boolean | null)
    // Only flag `=== true` and `!== false` which are always redundant
    if (boolLiteral === 'false' && (opText === '===' || opText === '==')) return null
    if (boolLiteral === 'true' && (opText === '!==' || opText === '!=')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary boolean comparison',
      `Comparing to \`${boolLiteral}\` is redundant — use the expression directly or negate it.`,
      sourceCode,
      `Remove the \`=== ${boolLiteral}\` comparison and use the expression directly.`,
    )
  },
}
