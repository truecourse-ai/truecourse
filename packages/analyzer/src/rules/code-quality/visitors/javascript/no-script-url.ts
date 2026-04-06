import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noScriptUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-script-url',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    if (/javascript\s*:/i.test(text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Script URL',
        '`javascript:` URLs are a form of eval. Use event handlers instead.',
        sourceCode,
        'Replace javascript: URL with an event handler or proper navigation.',
      )
    }
    return null
  },
}
