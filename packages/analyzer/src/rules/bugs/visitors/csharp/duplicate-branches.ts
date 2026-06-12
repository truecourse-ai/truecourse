import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Two branches of an if / else if chain with identical multi-statement
 * bodies — almost always a copy-paste error. Single-statement duplicates
 * (`return null;` in several guards) are idiomatic and skipped.
 */
export const csharpDuplicateBranchesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-branches',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    if (node.parent?.type === 'if_statement' && node.parent.childForFieldName('alternative')?.id === node.id) {
      return null
    }

    const bodies: string[] = []
    let current: SyntaxNode | null = node
    while (current && current.type === 'if_statement') {
      const consequence = current.childForFieldName('consequence')
      if (consequence) {
        const bodyText = consequence.text.trim()
        if (bodies.includes(bodyText)) {
          const stmtCount = consequence.type === 'block'
            ? consequence.namedChildren.filter((c) => c && c.type !== 'comment').length
            : 1
          if (stmtCount > 1) {
            return makeViolation(
              this.ruleKey, current, filePath, 'medium',
              'Duplicate branch body',
              'This branch has identical code to an earlier branch — likely a copy-paste error.',
              sourceCode,
              'Fix the branch body to differ or merge the conditions.',
            )
          }
        }
        bodies.push(bodyText)
      }

      const alternative: SyntaxNode | null = current.childForFieldName('alternative')
      current = alternative?.type === 'if_statement' ? alternative : null
    }
    return null
  },
}
