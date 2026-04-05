import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const trivialSwitchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/trivial-switch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null
    const cases = body.namedChildren.filter((c) => c.type === 'switch_case' || c.type === 'switch_default')
    if (cases.length <= 2) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Trivial switch statement',
        `Switch statement with only ${cases.length} case(s) should be an \`if\` statement for clarity.`,
        sourceCode,
        'Replace the switch with an if/else statement.',
      )
    }
    return null
  },
}
