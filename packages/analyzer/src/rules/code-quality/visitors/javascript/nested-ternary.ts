import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

export const nestedTernaryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-ternary',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['ternary_expression'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')

    function containsTernary(n: SyntaxNode): boolean {
      if (n.type === 'ternary_expression') return true
      if (n.type === 'parenthesized_expression') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child && containsTernary(child)) return true
        }
      }
      return false
    }

    const hasTernaryChild = (consequence && containsTernary(consequence)) ||
      (alternative && containsTernary(alternative))

    if (hasTernaryChild) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Nested ternary expression',
        'Ternary inside a ternary is hard to read. Use if/else or extract the logic into a helper function.',
        sourceCode,
        'Replace nested ternary with if/else or a helper function.',
      )
    }
    return null
  },
}
