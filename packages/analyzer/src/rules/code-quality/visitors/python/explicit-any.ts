import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonExplicitAnyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-explicit-any',
  languages: ['python'],
  nodeTypes: ['type'],
  visit(node, filePath, sourceCode) {
    // tree-sitter Python wraps annotations in `type` nodes whose children are identifiers.
    // The parent of a `type` node is the annotation context: typed_parameter, function_definition,
    // assignment, etc. — never another `type` node.  Just check that our `type` node's text is `Any`.
    if (node.text === 'Any') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Explicit `Any` type',
        'Using `Any` bypasses type checking. Use a specific type or protocol instead.',
        sourceCode,
        'Replace `Any` with a specific type, `object`, or a Protocol.',
      )
    }
    return null
  },
}
