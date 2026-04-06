import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const bindAllInterfacesVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/bind-all-interfaces',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (methodName !== 'listen') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'string') {
        const val = arg.text.replace(/['"]/g, '')
        if (val === '0.0.0.0') {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Server binding to all interfaces',
            'server.listen() binding to 0.0.0.0 exposes the service on all network interfaces.',
            sourceCode,
            'Bind to a specific interface (e.g., 127.0.0.1) or use an environment variable for the host.',
          )
        }
      }
    }

    return null
  },
}
