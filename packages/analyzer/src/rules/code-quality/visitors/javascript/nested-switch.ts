import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const nestedSwitchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-switch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    let parent = node.parent
    while (parent) {
      if (parent.type === 'switch_statement') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Nested switch statement',
          'Switch inside another switch is hard to read. Extract the inner switch into a helper function.',
          sourceCode,
          'Extract the inner switch into a separate function.',
        )
      }
      parent = parent.parent
    }
    return null
  },
}
