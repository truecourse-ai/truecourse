import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonProductionDebugEnabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/production-debug-enabled',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (!left || !right) return null

    // DEBUG = True or app.debug = True
    const leftText = left.text.toLowerCase()
    if ((leftText === 'debug' || leftText.endsWith('.debug')) && right.text === 'True') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Production debug enabled',
        'Debug mode is enabled. This may leak sensitive information in production.',
        sourceCode,
        'Set DEBUG = False in production configurations.',
      )
    }

    return null
  },
}
