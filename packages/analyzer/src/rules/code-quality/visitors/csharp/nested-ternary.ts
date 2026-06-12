import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const csharpNestedTernaryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-ternary',
  languages: ['csharp'],
  nodeTypes: ['conditional_expression'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')

    function containsTernary(n: SyntaxNode): boolean {
      if (n.type === 'conditional_expression') return true
      if (n.type === 'parenthesized_expression') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child && containsTernary(child)) return true
        }
      }
      return false
    }

    const hasTernaryChild = (consequence && containsTernary(consequence))
      || (alternative && containsTernary(alternative))

    if (hasTernaryChild) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Nested ternary expression',
        'Ternary inside a ternary is hard to read. Use if/else or a switch expression instead.',
        sourceCode,
        'Replace the nested ternary with if/else or a switch expression.',
      )
    }
    return null
  },
}
