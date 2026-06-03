import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsMethodCall } from './_helpers.js'

// Events whose target owns the listener's lifecycle — the listener becomes
// irrelevant when the event fires or when the host object is disposed of,
// so requiring a paired removeEventListener call would be wrong.
const LIFECYCLE_EVENT_TYPES = new Set([
  'abort',          // AbortSignal — auto-detaches when aborted
  'close',          // WebSocket / EventSource — released by host.close()
  'error',          // WebSocket / EventSource — released by host.close()
  'beforeunload',   // window — page unload tears down all listeners
  'unload',         // window — same
  'visibilitychange', // document — bound to page lifecycle
])

// Receiver text patterns suggesting an object whose listeners are managed by
// its own lifecycle (AbortSignal/EventSource/WebSocket).
const LIFECYCLE_RECEIVER_RE = /(^|\.)(signal|abortSignal|eventSource|ws|socket)\??$/

export const eventListenerNoRemoveVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/event-listener-no-remove',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'addEventListener') return null

    // Skip patterns where the listener's lifetime is bounded by something
    // other than an explicit removeEventListener — AbortSignal abort
    // handlers, `{ once: true }` listeners, WebSocket/EventSource close/error
    // handlers, and window/document terminal-lifecycle events.
    const args = node.childForFieldName('arguments')
    const argNodes = args?.namedChildren ?? []

    const eventTypeArg = argNodes[0]
    if (eventTypeArg && eventTypeArg.type === 'string') {
      const eventType = eventTypeArg.text.replace(/^['"`]|['"`]$/g, '')
      if (LIFECYCLE_EVENT_TYPES.has(eventType)) return null
    }

    const optionsArg = argNodes[2]
    if (optionsArg && optionsArg.type === 'object' && objectHasOnceTrue(optionsArg)) return null

    const obj = fn.childForFieldName('object')
    if (obj && LIFECYCLE_RECEIVER_RE.test(obj.text)) return null

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

function objectHasOnceTrue(obj: SyntaxNode): boolean {
  for (const child of obj.namedChildren) {
    if (child.type !== 'pair') continue
    const key = child.childForFieldName('key')
    const value = child.childForFieldName('value')
    if (!key || !value) continue
    const keyText = key.text.replace(/^['"`]|['"`]$/g, '')
    if (keyText === 'once' && value.text === 'true') return true
  }
  return false
}
