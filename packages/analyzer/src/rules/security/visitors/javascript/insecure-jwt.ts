import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const INSECURE_JWT_ALGORITHMS = new Set(['none', 'hs256'])

export const insecureJwtVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-jwt',
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

    if (methodName !== 'sign' && methodName !== 'verify') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Look for options object with algorithm property
    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if ((key?.text === 'algorithm' || key?.text === 'algorithms') && value) {
              const algText = value.text.replace(/['"]/g, '').toLowerCase()
              if (INSECURE_JWT_ALGORITHMS.has(algText)) {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'Insecure JWT configuration',
                  `JWT ${methodName}() with algorithm "${value.text.replace(/['"]/g, '')}" is insecure.`,
                  sourceCode,
                  'Use RS256, ES256, or another strong asymmetric algorithm for JWT signing.',
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
