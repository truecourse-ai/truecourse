import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unverifiedCrossOriginMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unverified-cross-origin-message',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (methodName !== 'addEventListener') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const eventType = firstArg.text.replace(/['"]/g, '')
    if (eventType !== 'message') return null

    // Get the handler function
    const handler = args.namedChildren[1]
    if (!handler) return null

    // Check if the handler body references .origin
    const handlerText = handler.text
    if (!handlerText.includes('origin')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unverified cross-origin message',
        'Message event listener without origin verification. Any window can send messages.',
        sourceCode,
        'Check event.origin against a trusted list before processing the message.',
      )
    }

    return null
  },
}
