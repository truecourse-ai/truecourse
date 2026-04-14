import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsMethodCall } from './_helpers.js'

export const eventListenerNoRemoveVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/event-listener-no-remove',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'addEventListener') return null

    // Find the enclosing function body
    let enclosingBody: SyntaxNode | null = null
    let current = node.parent
    while (current) {
      if (
        current.type === 'function_declaration' ||
        current.type === 'arrow_function' ||
        current.type === 'function' ||
        current.type === 'method_definition'
      ) {
        enclosingBody = current.childForFieldName('body')
        break
      }
      // If we hit program/module level, use that
      if (current.type === 'program') {
        enclosingBody = current
        break
      }
      current = current.parent
    }

    if (!enclosingBody) return null

    // Check if same scope has removeEventListener
    const hasRemove = containsMethodCall(enclosingBody, new Set(['removeEventListener']))
    if (hasRemove) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'addEventListener without removeEventListener',
      'Event listener added without a corresponding removeEventListener in the same scope, which can cause memory leaks.',
      sourceCode,
      'Add a corresponding removeEventListener call, e.g., in a cleanup function or componentWillUnmount.',
    )
  },
}
