import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const duplicateBranchesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-branches',
  languages: JS_LANGUAGES,
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Only process the top-level if (not nested else-if)
    if (node.parent?.type === 'else_clause') return null

    const bodies: { text: string; node: SyntaxNode }[] = []
    let current: SyntaxNode | null = node

    while (current && current.type === 'if_statement') {
      const consequence = current.childForFieldName('consequence')
      if (consequence) {
        const bodyText = consequence.text.trim()
        const duplicate = bodies.find((b) => b.text === bodyText)
        if (duplicate) {
          return makeViolation(
            this.ruleKey, current, filePath, 'medium',
            'Duplicate branch body',
            'This branch has identical code to an earlier branch — likely a copy-paste error.',
            sourceCode,
            'Fix the branch body to differ or merge the conditions.',
          )
        }
        bodies.push({ text: bodyText, node: consequence })
      }

      const alternative = current.childForFieldName('alternative')
      if (alternative?.type === 'else_clause') {
        current = alternative.namedChildren.find((c) => c.type === 'if_statement') || null
      } else {
        current = null
      }
    }
    return null
  },
}
