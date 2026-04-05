import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingStrictTransportVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/missing-strict-transport',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    if (funcName !== 'helmet') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if (key?.text === 'hsts' && value?.text === 'false') {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'Missing HSTS',
                'Helmet configured with HSTS disabled. HSTS prevents protocol downgrade attacks.',
                sourceCode,
                'Enable HSTS: helmet({ hsts: { maxAge: 31536000, includeSubDomains: true } }).',
              )
            }
          }
        }
      }
    }

    return null
  },
}
