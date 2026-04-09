import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingNullCheckAfterFindVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/missing-null-check-after-find',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'find') return null

    // Check how the result is used — look at parent
    const parent = node.parent
    if (!parent) return null

    // Skip if optional chaining is used: arr.find(...)?.property
    if (parent.type === 'optional_chain_expression') return null

    // If result is used in member access immediately: arr.find(...).property
    if (parent.type === 'member_expression' && parent.childForFieldName('object') === node) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Missing null check after .find()',
        '.find() may return undefined. Accessing a property on the result without a null check can throw.',
        sourceCode,
        'Check the .find() result for undefined before accessing properties (use optional chaining ?. or an if check).',
      )
    }

    // If result is used in a call: arr.find(...).method()
    if (parent.type === 'call_expression') {
      const parentFn = parent.childForFieldName('function')
      if (parentFn?.type === 'member_expression' && parentFn.childForFieldName('object') === node) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Missing null check after .find()',
          '.find() may return undefined. Calling a method on the result without a null check can throw.',
          sourceCode,
          'Check the .find() result for undefined before calling methods on it.',
        )
      }
    }

    return null
  },
}
