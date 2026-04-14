import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noAlertVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-alert',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null
    if (fn.text === 'alert' || fn.text === 'confirm' || fn.text === 'prompt') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `${fn.text}() call`,
        `\`${fn.text}()\` blocks the UI thread and should not be used in production. Use a modal dialog or custom UI instead.`,
        sourceCode,
        `Replace ${fn.text}() with a non-blocking modal or custom UI component.`,
      )
    }
    return null
  },
}
