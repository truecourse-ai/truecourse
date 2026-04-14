import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnecessaryBooleanCompareVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-boolean-compare',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    // Only flag loose equality (== / !=) — strict equality (=== / !==) is intentional
    // for tri-state values (boolean | null, boolean | undefined)
    const op = node.children.find((c) => c.type === '==' || c.type === '!=')
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

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary boolean comparison',
      `Comparing to \`${boolLiteral}\` with \`${opText}\` is redundant — use the expression directly or negate it.`,
      sourceCode,
      `Remove the \`${opText} ${boolLiteral}\` comparison and use the expression directly.`,
    )
  },
}
