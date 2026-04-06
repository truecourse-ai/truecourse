import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAnyTypeHintVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/any-type-hint',
  languages: ['python'],
  nodeTypes: ['type'],
  visit(node, filePath, sourceCode) {
    // In Python tree-sitter grammar, type annotations use 'type' nodes
    const text = node.text.trim()
    if (text !== 'Any') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Any used as type hint',
      'Using `Any` as a type hint defeats type checking — use a more specific type.',
      sourceCode,
      'Replace `Any` with a specific type annotation, or use `object` if truly any type is acceptable.',
    )
  },
}
