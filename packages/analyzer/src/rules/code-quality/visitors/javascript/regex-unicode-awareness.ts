import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const regexUnicodeAwarenessVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-unicode-awareness',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.namedChildren.find((c) => c.type === 'regex_pattern')
    const flagsNode = node.namedChildren.find((c) => c.type === 'regex_flags')
    const src = pattern?.text ?? ''
    const flags = flagsNode?.text ?? ''

    if (/\\[pP]\{/.test(src) && !flags.includes('u') && !flags.includes('v')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Missing unicode flag in regex',
        'Regex contains Unicode property escapes `\\p{...}` or `\\P{...}` which require the `u` or `v` flag.',
        sourceCode,
        'Add the `u` flag to the regex: `/.../u`.',
      )
    }
    return null
  },
}
