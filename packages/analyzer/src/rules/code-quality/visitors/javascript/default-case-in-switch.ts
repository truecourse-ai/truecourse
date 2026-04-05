import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const defaultCaseInSwitchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/default-case-in-switch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const hasDefault = body.namedChildren.some((c) => c.type === 'switch_default')
    if (hasDefault) return null

    const cases = body.namedChildren.filter((c) => c.type === 'switch_case')
    if (cases.length === 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Missing default case in switch',
      'Switch statement has no `default` case — may silently ignore unexpected values.',
      sourceCode,
      'Add a `default` case to handle unexpected values.',
    )
  },
}
