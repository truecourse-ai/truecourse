import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const tooManySwitchCasesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-switch-cases',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const caseCount = body.namedChildren.filter((c) => c.type === 'switch_case').length
    if (caseCount > 10) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many switch cases',
        `Switch has ${caseCount} cases (max 10). Consider using a lookup table or polymorphism.`,
        sourceCode,
        'Replace the switch with an object lookup table or strategy pattern.',
      )
    }
    return null
  },
}
