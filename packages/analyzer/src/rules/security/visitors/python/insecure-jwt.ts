import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonInsecureJwtVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-jwt',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    if (methodName !== 'encode' && methodName !== 'decode') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'algorithm' || name?.text === 'algorithms') {
          const algText = value?.text.replace(/['"]/g, '').toLowerCase() ?? ''
          if (algText === 'none' || algText === 'hs256') {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Insecure JWT configuration',
              `JWT ${methodName}() with algorithm "${value?.text.replace(/['"]/g, '')}" is insecure.`,
              sourceCode,
              'Use RS256, ES256, or another strong asymmetric algorithm.',
            )
          }
        }
      }
    }

    return null
  },
}
