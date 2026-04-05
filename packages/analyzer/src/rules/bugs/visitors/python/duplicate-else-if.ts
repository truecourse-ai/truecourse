import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDuplicateElseIfVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-else-if',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Only process the top-level if (not nested elif)
    if (node.parent?.type === 'elif_clause' || node.parent?.type === 'else_clause') return null

    const conditions: string[] = []

    // Collect conditions from if and all elif branches
    const ifCondition = node.childForFieldName('condition')
    if (ifCondition) conditions.push(ifCondition.text)

    for (const child of node.namedChildren) {
      if (child.type === 'elif_clause') {
        const elifCondition = child.childForFieldName('condition')
        if (elifCondition) {
          const condText = elifCondition.text
          if (conditions.includes(condText)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'high',
              'Duplicate elif condition',
              `Condition \`${condText}\` is duplicated in this if/elif chain — the second branch is dead code.`,
              sourceCode,
              'Remove the duplicate condition or change it to check something different.',
            )
          }
          conditions.push(condText)
        }
      }
    }
    return null
  },
}
