import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unverifiedHostnameVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unverified-hostname',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    const value = node.childForFieldName('value')

    if (key?.text === 'checkServerIdentity' && value) {
      // checkServerIdentity: () => undefined  or  checkServerIdentity: function() {}
      if (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unverified hostname',
          'Custom checkServerIdentity disables TLS hostname verification.',
          sourceCode,
          'Remove the custom checkServerIdentity to use the default hostname verification.',
        )
      }
    }

    return null
  },
}
