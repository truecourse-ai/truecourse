import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const requireUnicodeRegexpVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-unicode-regexp',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    // Check if the regex has the u or v flag
    const flags = node.childForFieldName('flags')
    const flagText = flags?.text ?? ''

    if (flagText.includes('u') || flagText.includes('v')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'RegExp missing unicode flag',
      'Regular expression should use the `u` or `v` flag for correct Unicode character handling.',
      sourceCode,
      `Add the \`u\` flag: ${node.text}u`,
    )
  },
}
