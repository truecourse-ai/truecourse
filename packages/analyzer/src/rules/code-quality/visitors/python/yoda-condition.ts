import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const CONSTANT_TYPES = new Set(['integer', 'float', 'string', 'true', 'false', 'none'])

export const pythonYodaConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/yoda-condition',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren
    if (children.length < 2) return null

    // Check if has ==, !=, <, >, <=, >= operators
    const hasCompOp = node.children.some((c) =>
      ['==', '!=', '<', '>', '<=', '>='].includes(c.type) ||
      ['==', '!=', '<', '>', '<=', '>='].includes(c.text),
    )
    if (!hasCompOp) return null

    const left = children[0]
    const right = children[children.length - 1]

    // Yoda: constant on left, non-constant on right
    const leftIsConstant = CONSTANT_TYPES.has(left.type) ||
      (left.type === 'identifier' && /^[A-Z_][A-Z0-9_]+$/.test(left.text)) // ALL_CAPS constant
    const rightIsConstant = CONSTANT_TYPES.has(right.type)

    if (leftIsConstant && !rightIsConstant) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Yoda condition',
        `Constant \`${left.text}\` is on the left side — write \`${right.text} == ${left.text}\` instead.`,
        sourceCode,
        'Move the variable to the left side of the comparison for better readability.',
      )
    }
    return null
  },
}
