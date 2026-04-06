import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnverifiedHostnameVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unverified-hostname',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (left?.type === 'attribute') {
      const attr = left.childForFieldName('attribute')
      if (attr?.text === 'check_hostname' && right?.text === 'False') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unverified hostname',
          'Setting check_hostname to False disables TLS hostname verification.',
          sourceCode,
          'Set check_hostname = True to verify server hostnames.',
        )
      }
    }

    return null
  },
}
