import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

export const unsafeFunctionTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unsafe-function-type',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['type_annotation'],
  visit(node, filePath, sourceCode) {
    function hasFunctionType(n: SyntaxNode): boolean {
      if ((n.type === 'predefined_type' || n.type === 'type_identifier') && n.text === 'Function') return true
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child && hasFunctionType(child)) return true
      }
      return false
    }

    if (hasFunctionType(node)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unsafe Function type',
        'The `Function` type accepts any function. Use a specific signature like `() => void` for type safety.',
        sourceCode,
        'Replace `Function` with a specific function type signature.',
      )
    }
    return null
  },
}
