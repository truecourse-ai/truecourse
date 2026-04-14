import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNumpyNonzeroPreferredVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/numpy-nonzero-preferred',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if ((obj?.text !== 'np' && obj?.text !== 'numpy') || attr?.text !== 'where') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((c) => c.type !== 'keyword_argument')
    // np.where with only 1 arg (condition only) should use np.nonzero
    if (positionalArgs.length === 1) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'np.where without alternatives',
        '`np.where(condition)` with only a condition argument is equivalent to `np.nonzero(condition)`. `np.nonzero` is clearer for this use case.',
        sourceCode,
        'Replace `np.where(condition)` with `np.nonzero(condition)` to express intent more clearly.',
      )
    }

    return null
  },
}
