import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonExplicitAnyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-explicit-any',
  languages: ['python'],
  nodeTypes: ['type'],
  visit(node, filePath, sourceCode) {
    if (node.text === 'Any') {
      const parent = node.parent
      if (parent?.type === 'type') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Explicit `Any` type',
          'Using `Any` bypasses type checking. Use a specific type or protocol instead.',
          sourceCode,
          'Replace `Any` with a specific type, `object`, or a Protocol.',
        )
      }
    }
    return null
  },
}
