import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import { JS_LANGUAGES, PURE_ARRAY_METHODS, SOCKET_IO_RECEIVERS } from './_helpers.js'

// Leftmost identifier name of a receiver expression: `socket` → "socket",
// `this.socket` / `client.socket` → "socket". Used to recognize a socket.io
// connection without type information.
function receiverBaseName(obj: SyntaxNode | null): string | null {
  if (!obj) return null
  if (obj.type === 'identifier') return obj.text.toLowerCase()
  if (obj.type === 'member_expression') {
    const prop = obj.childForFieldName('property')
    return prop ? prop.text.toLowerCase() : null
  }
  return null
}

export const ignoredReturnValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/ignored-return-value',
  languages: JS_LANGUAGES,
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'call_expression') return null

    const fn = expr.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || !PURE_ARRAY_METHODS.has(prop.text)) return null

    // `socket.join(room)` is socket.io's side-effecting room subscription, not
    // `Array.prototype.join` — its void result is correctly ignored. Skip when
    // the receiver names a realtime connection.
    if (prop.text === 'join') {
      const base = receiverBaseName(fn.childForFieldName('object'))
      if (base && SOCKET_IO_RECEIVERS.has(base)) return null
    }

    // Skip if used as an await expression target or similar
    return makeViolation(
      this.ruleKey, expr, filePath, 'high',
      'Ignored return value',
      `The return value of \`.${prop.text}()\` is ignored — this method does not mutate the array in place; the result must be used.`,
      sourceCode,
      `Assign the result: \`const result = arr.${prop.text}(...)\`.`,
    )
  },
}
