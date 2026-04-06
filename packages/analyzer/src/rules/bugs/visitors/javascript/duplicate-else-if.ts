import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const duplicateElseIfVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-else-if',
  languages: JS_LANGUAGES,
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Only process the top-level if (not nested else-if)
    if (node.parent?.type === 'else_clause') return null

    const conditions: string[] = []
    let current: SyntaxNode | null = node

    while (current && current.type === 'if_statement') {
      const condition = current.childForFieldName('condition')
      if (condition) {
        const condText = condition.text
        if (conditions.includes(condText)) {
          return makeViolation(
            this.ruleKey, current, filePath, 'high',
            'Duplicate else-if condition',
            `Condition \`${condText}\` is duplicated in this if/else if chain — the second branch is dead code.`,
            sourceCode,
            'Remove the duplicate condition or change it to check something different.',
          )
        }
        conditions.push(condText)
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
