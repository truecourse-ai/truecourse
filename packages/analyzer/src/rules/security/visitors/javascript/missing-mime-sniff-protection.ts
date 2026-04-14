import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingMimeSniffProtectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/missing-mime-sniff-protection',
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
            if (key?.text === 'noSniff' && value?.text === 'false') {
              return makeViolation(
                this.ruleKey, node, filePath, 'medium',
                'Missing MIME sniff protection',
                'Helmet configured with noSniff disabled. Browsers may misinterpret file types.',
                sourceCode,
                'Enable noSniff to set X-Content-Type-Options: nosniff.',
              )
            }
          }
        }
      }
    }

    return null
  },
}
