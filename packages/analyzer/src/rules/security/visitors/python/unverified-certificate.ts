import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnverifiedCertificateVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unverified-certificate',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // ssl._create_unverified_context()
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr?.text === '_create_unverified_context' && obj?.text === 'ssl') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unverified TLS certificate',
          'ssl._create_unverified_context() disables TLS certificate verification.',
          sourceCode,
          'Use ssl.create_default_context() instead.',
        )
      }
    }

    // requests.get(..., verify=False)
    const args = node.childForFieldName('arguments')
    if (args) {
      for (const arg of args.namedChildren) {
        if (arg.type === 'keyword_argument') {
          const name = arg.childForFieldName('name')
          const value = arg.childForFieldName('value')
          if (name?.text === 'verify' && value?.text === 'False') {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Unverified TLS certificate',
              'Setting verify=False disables TLS certificate verification.',
              sourceCode,
              'Remove verify=False or set verify=True.',
            )
          }
        }
      }
    }

    return null
  },
}
