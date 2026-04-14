import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonTfGatherValidateIndicesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/tf-gather-validate-indices',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // tf.gather(...)
    let isTfGather = false
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr?.text === 'gather' && (obj?.text === 'tf' || obj?.text === 'tensorflow')) {
        isTfGather = true
      }
    }

    if (!isTfGather) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const hasValidateIndices = args.namedChildren.some((child) => {
      if (child.type === 'keyword_argument') {
        const key = child.childForFieldName('name')
        return key?.text === 'validate_indices'
      }
      return false
    })

    if (hasValidateIndices) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'tf.gather validate_indices deprecated',
        '`validate_indices` argument is deprecated in `tf.gather` and has no effect in TensorFlow 2.x.',
        sourceCode,
        'Remove the `validate_indices` argument from `tf.gather()`.',
      )
    }

    return null
  },
}
