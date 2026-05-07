import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const mixedHttpMethodsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/mixed-http-methods',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type !== 'member_expression') return null
    const prop = fn.childForFieldName('property')
    if (!prop) return null

    if (prop.text !== 'all') return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null

    const objText = obj.text
    if (!/(app|router|server|express)/.test(objText.toLowerCase())) return null

    // Skip when the path or the handler name signals a read-only
    // intent. The rule's risk is GET-routed state mutation; if the
    // route is clearly a list/fetch/get/search, allowing GET is
    // legitimate (and `.all()` works as a permissive aliased GET).
    // documenso's `.all('/zapier/list-documents', listDocumentsHandler)`
    // is the canonical FP shape — list+handler-name both signal read.
    const args = node.childForFieldName('arguments')
    const READ_ONLY_HINTS = /\b(?:list|get|fetch|find|search|view|read|query|describe)[A-Z_-]/
    if (args) {
      const pathArg = args.namedChildren[0]
      const handlerArg = args.namedChildren[1]
      // Path string: strip quotes and check for read-only verb segments
      if (pathArg?.type === 'string') {
        const inner = pathArg.text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')
        if (/\/(?:list|get|fetch|find|search|view|read|query|describe)[a-z-]*(?:\b|\/)/i.test(inner)) return null
      }
      // Handler identifier or member: look for read-only verb prefix
      if (handlerArg) {
        const handlerText = handlerArg.text
        if (READ_ONLY_HINTS.test(handlerText)) return null
        // arrow function calling a list/get-shaped helper inside its body
        if (/=>\s*(?:list|get|fetch|find|search|view|read|query|describe)[A-Z_-]/.test(handlerText)) return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Route handling mixed HTTP methods',
      `${objText}.all() registers the route for all HTTP methods including GET, which should not trigger state changes.`,
      sourceCode,
      'Use specific HTTP method handlers (app.get, app.post) instead of app.all().',
    )
  },
}
