import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const SNMP_WEAK_CRYPTO = new Set(['md5', 'des', 'sha1'])

export const snmpWeakCryptoVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/snmp-weak-crypto',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) funcName = prop.text
    } else if (fn.type === 'identifier') {
      funcName = fn.text
    }

    if (funcName !== 'createSession' && funcName !== 'Session') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            const keyText = key?.text?.replace(/['"]/g, '').toLowerCase() ?? ''
            if ((keyText === 'authalgorithm' || keyText === 'privalgorithm') && value) {
              const alg = value.text.replace(/['"]/g, '').toLowerCase()
              if (SNMP_WEAK_CRYPTO.has(alg) || /md5|des|sha1/.test(alg)) {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'SNMP weak cryptography',
                  `SNMP session configured with weak algorithm "${value.text.replace(/['"]/g, '')}".`,
                  sourceCode,
                  'Use SHA-256 or AES-128 for SNMP v3 authentication and privacy algorithms.',
                )
              }
            }
          }
        }
      }
    }

    return null
  },
}
