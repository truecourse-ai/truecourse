import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const jsStylePreferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/js-style-preference',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['variable_declaration'],
  visit(node, filePath, sourceCode) {
    // Flag use of var
    const firstChild = node.children[0]
    if (firstChild?.text === 'var') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Use of var instead of const/let',
        'var has function scope and hoisting issues. Use const for constants or let for variables.',
        sourceCode,
        'Replace var with const (if not reassigned) or let.',
      )
    }

    return null
  },
}
