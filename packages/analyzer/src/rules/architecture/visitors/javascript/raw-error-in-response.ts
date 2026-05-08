import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const rawErrorInResponseVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/raw-error-in-response',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    if (!filePath.match(/(?:route|controller|handler|api|server)/i)) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    const param = node.childForFieldName('parameter')
    if (!param) return null
    const errName = param.text.replace(/:.+/, '').trim()

    // Skip when the only `err.message` / `err.stack` use is inside a
    // React state setter call (`setTokenError(err.message)`,
    // `setError(err.message)`). Those are for client-side display,
    // not sent over the wire.
    function isOnlyInsideStateSetter(): boolean {
      let foundUse = false
      let allInSetter = true
      function walk(n: import('web-tree-sitter').Node) {
        if (n.type === 'member_expression') {
          const obj = n.childForFieldName('object')
          const prop = n.childForFieldName('property')
          if (obj?.text === errName && (prop?.text === 'message' || prop?.text === 'stack')) {
            foundUse = true
            // Walk up to find the enclosing call_expression.
            let cursor: import('web-tree-sitter').Node | null = n.parent
            let inSetter = false
            while (cursor && cursor !== body) {
              if (cursor.type === 'call_expression') {
                const fn = cursor.childForFieldName('function')
                let name = ''
                if (fn?.type === 'identifier') name = fn.text
                else if (fn?.type === 'member_expression') name = fn.childForFieldName('property')?.text ?? ''
                if (/^set[A-Z]/.test(name)) { inSetter = true; break }
              }
              cursor = cursor.parent
            }
            if (!inSetter) allInSetter = false
          }
        }
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c) walk(c)
        }
      }
      walk(body!)
      return foundUse && allInSetter
    }

    // Check if error details are sent in response
    if (
      bodyText.includes(`${errName}.stack`) ||
      bodyText.includes(`${errName}.message`) ||
      // res.json(err) or res.send(err)
      bodyText.match(new RegExp(`res\\.(?:json|send)\\(${errName}\\)`))
    ) {
      if (isOnlyInsideStateSetter()) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Error details exposed in API response',
        `Error details (stack, message) from '${errName}' sent to client. This leaks implementation details.`,
        sourceCode,
        'Send a generic error message to the client and log the full error server-side.',
      )
    }

    return null
  },
}
