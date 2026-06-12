import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A repeated condition in an if / else if chain — the later branch is dead
 * code because the earlier identical condition already matched.
 */
export const csharpDuplicateElseIfVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-else-if',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Only process the head of the chain (alternative ifs are visited via the walk)
    if (node.parent?.type === 'if_statement' && node.parent.childForFieldName('alternative')?.id === node.id) {
      return null
    }

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

      const alternative: SyntaxNode | null = current.childForFieldName('alternative')
      current = alternative?.type === 'if_statement' ? alternative : null
    }
    return null
  },
}
