import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const elseifWithoutElseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/elseif-without-else',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (parent?.type === 'else_clause') return null

    // Skip files in /components/ui/ directories (third-party generated components like shadcn/ui)
    if (/\/components\/ui\//.test(filePath)) return null

    let hasElseIf = false
    let hasElse = false

    let currentNode: SyntaxNode | null = node
    while (currentNode?.type === 'if_statement') {
      const elseClause: import('web-tree-sitter').Node | undefined = currentNode.children.find((c) => c.type === 'else_clause')
      if (!elseClause) break

      const elseBody: import('web-tree-sitter').Node | undefined = elseClause.namedChildren[0]
      if (!elseBody) break

      if (elseBody.type === 'if_statement') {
        hasElseIf = true
        currentNode = elseBody
      } else {
        hasElse = true
        break
      }
    }

    if (hasElseIf && !hasElse) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'else-if chain without final else',
        '`if...else if` chain has no final `else` clause — unhandled cases may be silently ignored.',
        sourceCode,
        'Add a final `else` clause to handle unexpected cases, or document why it is intentionally omitted.',
      )
    }
    return null
  },
}
