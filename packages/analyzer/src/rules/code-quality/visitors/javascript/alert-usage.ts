import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const BLOCKED_CALLS = new Set(['alert', 'confirm', 'prompt'])

export const jsAlertUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/alert-usage',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null
    if (fn.type !== 'identifier') return null
    const name = fn.text
    if (!BLOCKED_CALLS.has(name)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `${name}() dialog usage`,
      `\`${name}()\` blocks the browser UI thread. Use a custom modal or notification component instead.`,
      sourceCode,
      `Replace \`${name}()\` with a non-blocking UI component.`,
    )
  },
}
