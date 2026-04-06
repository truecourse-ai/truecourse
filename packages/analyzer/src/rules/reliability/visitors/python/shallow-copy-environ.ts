import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonShallowCopyEnvironVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/shallow-copy-environ',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right) return null

    if (right.type === 'attribute') {
      const obj = right.childForFieldName('object')
      const attr = right.childForFieldName('attribute')
      if (obj?.text === 'os' && attr?.text === 'environ') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'os.environ assigned directly',
          'Assigning os.environ directly creates a reference, not a copy. Mutations will affect the process environment.',
          sourceCode,
          'Use os.environ.copy() to get a safe copy of the environment.',
        )
      }
    }

    return null
  },
}
