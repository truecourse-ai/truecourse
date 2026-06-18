import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const csharpTooManySwitchCasesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-switch-cases',
  languages: ['csharp'],
  // Statement-form switches only. A `switch_expression` IS the lookup-table
  // form this rule recommends, so it is never flagged.
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Count sections with at least one `case` label (a section with several
    // labels sharing one body is still a single logical branch).
    const caseCount = body.namedChildren
      .filter((c) => c?.type === 'switch_section' && c.children.some((g) => g?.type === 'case'))
      .length
    if (caseCount > 10) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many switch cases',
        `Switch has ${caseCount} cases (max 10). Consider using a dictionary lookup or polymorphism.`,
        sourceCode,
        'Replace the switch with a dictionary lookup table or strategy pattern.',
      )
    }
    return null
  },
}
