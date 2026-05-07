import type { Node as SyntaxNode } from 'web-tree-sitter'
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

    // Listeners on owned DOM elements (`this.canvas.addEventListener`,
    // `el.addEventListener`, `node.addEventListener`) are reclaimed
    // automatically when the element is removed from the DOM — there's
    // no leak even without an explicit removeEventListener. The rule
    // is really about listeners on long-lived GLOBAL objects (window,
    // document, etc.) that outlive the consumer that registered them.
    //
    // documenso's signature-pad/canvas.ts had 9 hits: 1 real
    // (`window.addEventListener('resize', …)`) and 8 false
    // (`this.$canvas.addEventListener(…)` for mouse/pointer events
    // on the canvas itself). Restrict firing to receivers that are
    // long-lived globals.
    const GLOBAL_RECEIVERS = new Set([
      'window', 'document', 'globalThis', 'self', 'screen',
      'navigator', 'location', 'history',
    ])
    const receiver = fn.childForFieldName('object')
    if (!receiver) return null
    // Walk the receiver chain to its leftmost identifier
    let leftmost: SyntaxNode | null = receiver
    while (leftmost && leftmost.type === 'member_expression') {
      leftmost = leftmost.childForFieldName('object')
    }
    if (!leftmost || leftmost.type !== 'identifier') return null
    if (!GLOBAL_RECEIVERS.has(leftmost.text)) return null

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
