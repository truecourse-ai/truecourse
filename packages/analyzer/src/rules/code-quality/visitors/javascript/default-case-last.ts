import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const defaultCaseLastVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/default-case-last',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const cases = body.namedChildren
    if (cases.length === 0) return null

    let defaultIndex = -1
    for (let i = 0; i < cases.length; i++) {
      if (cases[i].type === 'switch_default') {
        defaultIndex = i
        break
      }
    }

    if (defaultIndex === -1) return null
    if (defaultIndex === cases.length - 1) return null

    return makeViolation(
      this.ruleKey, cases[defaultIndex], filePath, 'low',
      'Default case not last',
      'The `default` clause should be the last case in a `switch` statement for readability.',
      sourceCode,
      'Move the `default` clause to the end of the switch statement.',
    )
  },
}
