import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects tf.Variable() created inside a @tf.function decorated function —
 * should be created outside (singleton pattern).
 */
export const pythonTfVariableSingletonVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/tf-variable-singleton',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Check for tf.Variable()
    let isTfVar = false
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (attr?.text === 'Variable' && (obj?.text === 'tf' || obj?.text === 'tensorflow')) {
        isTfVar = true
      }
    }
    if (!isTfVar) return null

    // Check if inside a @tf.function decorated function
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_definition' || parent.type === 'async_function_definition') {
        // Check if this function has @tf.function decorator
        const decorated = parent.parent
        if (decorated?.type === 'decorated_definition') {
          const decs = decorated.namedChildren.filter((c) => c.type === 'decorator')
          if (decs.some((d) => d.text === '@tf.function' || d.text.includes('tf.function'))) {
            return makeViolation(
              this.ruleKey, node, filePath, 'medium',
              'tf.Variable inside @tf.function',
              '`tf.Variable()` created inside a `@tf.function` — variables should be created outside and reused (singleton pattern) to avoid inefficiency.',
              sourceCode,
              'Move `tf.Variable()` creation outside the `@tf.function` decorated function.',
            )
          }
        }
      }
      parent = parent.parent
    }

    return null
  },
}
