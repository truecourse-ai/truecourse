import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const productionDebugEnabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/production-debug-enabled',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    const value = node.childForFieldName('value')

    if (key?.text === 'debug' && value?.text === 'true') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Production debug enabled',
        'Debug mode is enabled in configuration. This may leak sensitive information.',
        sourceCode,
        'Set debug to false in production configurations.',
      )
    }

    return null
  },
}
