import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unverifiedCertificateVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unverified-certificate',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'pair') {
      const key = node.childForFieldName('key')
      const value = node.childForFieldName('value')
      if (key?.text === 'rejectUnauthorized' && value?.text === 'false') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unverified TLS certificate',
          'Setting rejectUnauthorized to false disables TLS certificate verification.',
          sourceCode,
          'Remove rejectUnauthorized: false or set it to true for production.',
        )
      }
    }

    if (node.type === 'assignment_expression') {
      const left = node.childForFieldName('left')
      const right = node.childForFieldName('right')
      if (left && right) {
        const leftText = left.text
        if (leftText.includes('NODE_TLS_REJECT_UNAUTHORIZED') && right.text === '"0"') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Unverified TLS certificate',
            'Setting NODE_TLS_REJECT_UNAUTHORIZED to "0" disables TLS verification globally.',
            sourceCode,
            'Remove this setting. Fix the certificate issue instead of disabling verification.',
          )
        }
      }
    }

    return null
  },
}
