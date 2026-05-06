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
          // Only `none` is genuinely insecure — it disables signature
          // verification entirely. HS256 is industry-standard symmetric
          // signing (used by GitHub, Google, etc. with proper secrets);
          // flagging it as "insecure" misleads users into changing
          // algorithms when their actual concern would be weak/reused
          // secrets. Reject only `none`.
          if (algText === 'none') {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Insecure JWT configuration',
              `JWT ${methodName}() with algorithm "none" disables signature verification entirely.`,
              sourceCode,
              'Use HS256 (with a strong secret) or RS256/ES256 (asymmetric) to enforce signature verification.',
            )
          }
        }
      }
    }

    return null
  },
}
