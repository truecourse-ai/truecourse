import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

/**
 * Detects f-strings nested more than 2 levels deep.
 */
export const pythonDeeplyNestedFstringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deeply-nested-fstring',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node: SyntaxNode, filePath, sourceCode) {
    // Must be an f-string
    const text = node.text
    if (!text.startsWith('f"') && !text.startsWith("f'") && !text.startsWith('f"""') && !text.startsWith("f'''")) return null

    // Count nesting depth by traversing parent chain
    let depth = 0
    let current: SyntaxNode | null = node.parent
    while (current) {
      if (
        current.type === 'string' &&
        (current.text.startsWith('f"') || current.text.startsWith("f'") || current.text.startsWith('f"""') || current.text.startsWith("f'''"))
      ) {
        depth++
      }
      current = current.parent
    }

    if (depth < 2) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Deeply nested f-string',
      `f-string nested ${depth + 1} levels deep — extract inner expressions to variables for readability.`,
      sourceCode,
      'Extract inner f-string expressions to named variables.',
    )
  },
}
