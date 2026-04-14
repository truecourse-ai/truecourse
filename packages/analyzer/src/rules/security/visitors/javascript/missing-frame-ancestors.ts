import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingFrameAncestorsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/missing-frame-ancestors',
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
            if (key?.text === 'frameguard' && value?.text === 'false') {
              return makeViolation(
                this.ruleKey, node, filePath, 'medium',
                'Missing frame ancestors protection',
                'Helmet configured with frameguard disabled. This removes clickjacking protection.',
                sourceCode,
                'Enable frameguard or set frame-ancestors in your CSP.',
              )
            }
          }
        }
      }
    }

    return null
  },
}
