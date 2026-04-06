import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnamedRegexCaptureVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnamed-regex-capture',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.namedChildren.find((c) => c.type === 'regex_pattern')
    const src = pattern?.text ?? ''

    let hasUnnamed = false
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue }
      if (src[i] === '(') {
        const next = src[i + 1]
        if (next !== '?') {
          hasUnnamed = true
          break
        }
      }
    }

    if (hasUnnamed) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnamed capture group',
        'Regex contains unnamed capture groups. Use named groups `(?<name>...)` for better readability.',
        sourceCode,
        'Convert capture groups to named: `(?<name>...)` or non-capturing: `(?:...)`.',
      )
    }
    return null
  },
}
