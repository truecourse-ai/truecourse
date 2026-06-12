import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isCSharpFunctionBoundary } from './_helpers.js'

export const csharpNestedSwitchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-switch',
  languages: ['csharp'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    let parent = node.parent
    while (parent) {
      // A switch inside a lambda is that function's own top-level dispatch.
      if (isCSharpFunctionBoundary(parent.type)) return null
      if (parent.type === 'switch_statement') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Nested switch statement',
          'Switch inside another switch is hard to read. Extract the inner switch into a helper method.',
          sourceCode,
          'Extract the inner switch into a separate method.',
        )
      }
      parent = parent.parent
    }
    return null
  },
}
