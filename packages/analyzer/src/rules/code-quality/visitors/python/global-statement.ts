import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonGlobalStatementVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/global-statement',
  languages: ['python'],
  nodeTypes: ['global_statement'],
  visit(node, filePath, sourceCode) {
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_definition') {
        const names = node.namedChildren.map((c) => c.text).join(', ')
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Global statement',
          `\`global ${names}\` modifies module-level state from inside a function. This makes code harder to reason about and test.`,
          sourceCode,
          'Refactor to pass state as arguments/return values, or use a class to encapsulate state.',
        )
      }
      parent = parent.parent
    }
    return null
  },
}
