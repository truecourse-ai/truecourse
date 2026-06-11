import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const AUGMENTABLE_OPS = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '??'])

/**
 * `x = x + 1` → `x += 1` (and `x = x ?? y` → `x ??= y`). Only fires when the
 * reused operand is the LEFT side of the binary expression, so non-commutative
 * cases stay correct.
 */
export const csharpNonAugmentedAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/non-augmented-assignment',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('operator')?.text !== '=') return null
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (left?.type !== 'identifier' || right?.type !== 'binary_expression') return null

    const op = right.childForFieldName('operator')?.text ?? ''
    if (!AUGMENTABLE_OPS.has(op)) return null
    const rightLeft = right.childForFieldName('left')
    if (rightLeft?.type !== 'identifier' || rightLeft.text !== left.text) return null

    const augOp = `${op}=`
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Non-augmented assignment',
      `\`${left.text} = ${left.text} ${op} …\` can be simplified to \`${left.text} ${augOp} …\`.`,
      sourceCode,
      `Use the compound assignment operator \`${augOp}\`.`,
    )
  },
}
