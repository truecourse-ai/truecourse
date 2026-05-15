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
      // `var` inside `declare global { ... }` / `declare module '...' { ... }`
      // is required TypeScript syntax for global augmentation (const/let are
      // invalid in that position). Skip those declarations.
      let parent = node.parent
      while (parent) {
        if (parent.type === 'ambient_declaration') return null
        parent = parent.parent
      }
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
