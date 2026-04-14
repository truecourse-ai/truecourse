import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects try blocks nested inside except handlers.
 */
export const pythonNestedTryCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/nested-try-catch',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    // Check if this try statement is directly inside an except clause
    let parent = node.parent
    while (parent) {
      if (parent.type === 'except_clause') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Deeply nested try-catch blocks',
          'A `try` block is nested inside an `except` handler — this creates convoluted error handling logic that is hard to follow and likely has bugs.',
          sourceCode,
          'Refactor: extract the inner try block into a separate function, or restructure error handling to avoid deep nesting.',
        )
      }
      if (
        parent.type === 'function_definition' ||
        parent.type === 'class_definition' ||
        parent.type === 'module'
      ) break
      parent = parent.parent
    }

    return null
  },
}
