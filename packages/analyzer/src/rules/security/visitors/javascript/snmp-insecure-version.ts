import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const snmpInsecureVersionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/snmp-insecure-version',
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
            if (key?.text?.replace(/['"]/g, '') === 'version' && value) {
              const versionText = value.text.replace(/['"]/g, '')
              // snmp v1 = "1" or snmp.Version1; v2c = "2c" or snmp.Version2c
              if (versionText === '1' || versionText === '2c' || /Version1|Version2c/.test(versionText)) {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'SNMP insecure version',
                  `SNMP session using version "${versionText}" which lacks encryption and authentication.`,
                  sourceCode,
                  'Use SNMPv3 with authPriv security level for encrypted and authenticated communication.',
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
