import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSnmpInsecureVersionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/snmp-insecure-version',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (methodName !== 'CommunityData' && methodName !== 'cmdgen') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // CommunityData('community', mpModel=0) means SNMPv1, mpModel=1 means SNMPv2c
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'mpModel' && (value?.text === '0' || value?.text === '1')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'SNMP insecure version',
            `CommunityData with mpModel=${value?.text} uses SNMP v${value?.text === '0' ? '1' : '2c'} without encryption.`,
            sourceCode,
            'Use UsmUserData for SNMPv3 with authentication and encryption.',
          )
        }
      }
    }

    return null
  },
}
