import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

/**
 * A try/catch nested inside a catch handler — error handling for the error
 * handling. The control flow is hard to follow and usually hides a missing
 * abstraction (fallback logic belongs in its own method).
 */
export const csharpNestedTryCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/nested-try-catch',
  languages: ['csharp'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    let parent = node.parent
    while (parent) {
      if (parent.type === 'catch_clause') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Try/catch nested inside a catch block',
          'A try/catch inside a catch handler creates convoluted error handling that is hard to follow.',
          sourceCode,
          'Extract the fallback logic into a separate method, or restructure the error handling to avoid nesting.',
        )
      }
      if (CSHARP_FUNCTION_BOUNDARIES.has(parent.type)) break
      parent = parent.parent
    }
    return null
  },
}
