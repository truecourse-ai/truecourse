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

    // Walk to module level so the removeEventListener search
    // includes the cleanup callback returned from useEffect (a
    // nested arrow function that doesn't share the same body
    // scope as the addEventListener call).
    let scope: SyntaxNode | null = node.parent
    let lastFn: SyntaxNode | null = null
    while (scope) {
      if (scope.type === 'function_declaration' || scope.type === 'arrow_function' ||
          scope.type === 'function' || scope.type === 'method_definition') {
        lastFn = scope
      }
      if (scope.type === 'program') break
      scope = scope.parent
    }
    // Search the OUTER function (the React component / hook) for any
    // removeEventListener call — the cleanup function lives inside
    // that scope as a nested arrow.
    const enclosingBody = lastFn
      ? (lastFn.childForFieldName('body') ?? scope)
      : scope
    if (!enclosingBody) return null

    // Match by event-name to allow same-event remove anywhere in
    // the file scope.
    const args = node.childForFieldName('arguments')
    const eventNameNode = args?.namedChild(0)
    const eventName = eventNameNode?.type === 'string'
      ? eventNameNode.text.replace(/^['"\`]|['"\`]$/g, '')
      : ''

    function hasMatchingRemove(n: SyntaxNode): boolean {
      if (n.type === 'call_expression') {
        const cfn = n.childForFieldName('function')
        if (cfn?.type === 'member_expression') {
          const cprop = cfn.childForFieldName('property')
          if (cprop?.text === 'removeEventListener') {
            if (!eventName) return true
            const cargs = n.childForFieldName('arguments')
            const enArg = cargs?.namedChild(0)
            const en = enArg?.type === 'string'
              ? enArg.text.replace(/^['"\`]|['"\`]$/g, '')
              : ''
            if (en === eventName) return true
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && hasMatchingRemove(c)) return true
      }
      return false
    }
    if (hasMatchingRemove(enclosingBody)) return null
    // Fallback: also check the unused legacy helper for backward
    // compatibility.
    if (containsMethodCall(enclosingBody, new Set(['removeEventListener']))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'addEventListener without removeEventListener',
      'Event listener added without a corresponding removeEventListener in the same scope, which can cause memory leaks.',
      sourceCode,
      'Add a corresponding removeEventListener call, e.g., in a cleanup function or componentWillUnmount.',
    )
  },
}
