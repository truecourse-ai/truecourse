import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const serverFingerprintingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/server-fingerprinting',
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

    // res.header('X-Powered-By', ...) or res.setHeader('X-Powered-By', ...)
    if (methodName === 'header' || methodName === 'setHeader' || methodName === 'set') {
      const args = node.childForFieldName('arguments')
      if (args && args.namedChildren.length >= 1) {
        const headerName = args.namedChildren[0]?.text.replace(/['"]/g, '').toLowerCase()
        if (headerName === 'x-powered-by') {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Server fingerprinting',
            'Setting X-Powered-By header reveals server technology to attackers.',
            sourceCode,
            'Remove the X-Powered-By header. Use app.disable("x-powered-by") in Express.',
          )
        }
      }
    }

    return null
  },
}
