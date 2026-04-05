import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects subclasses of tf.keras.Model that pass input_shape in their constructor
 * calls — this causes errors.
 */
export const pythonTfKerasInputShapeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/tf-keras-input-shape',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Check if class inherits from tf.keras.Model or keras.Model
    const superclasses = node.childForFieldName('superclasses')
    if (!superclasses) return null
    const superText = superclasses.text
    if (!superText.includes('keras.Model') && !superText.includes('Model')) return null
    // More precise check
    if (!superText.match(/(?:tf\.|keras\.)Model/) && superText !== 'Model') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check for __init__ or build methods with input_shape
    for (const child of body.namedChildren) {
      if (child.type !== 'function_definition') continue
      const nameNode = child.childForFieldName('name')
      if (!nameNode) continue

      const params = child.childForFieldName('parameters')
      if (!params) continue

      const paramTexts = params.namedChildren.map((c) => c.text)
      if (paramTexts.some((p) => p.includes('input_shape'))) {
        return makeViolation(
          this.ruleKey, child, filePath, 'medium',
          'input_shape in tf.keras.Model subclass',
          `Method \`${nameNode.text}\` in a \`tf.keras.Model\` subclass uses \`input_shape\` parameter — this is not supported for Model subclasses and will cause an error.`,
          sourceCode,
          'Remove `input_shape` from the method signature; override `build(self, input_shape)` if needed.',
        )
      }
    }

    return null
  },
}
