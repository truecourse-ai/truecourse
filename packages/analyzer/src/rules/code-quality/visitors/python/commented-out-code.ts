import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonCommentedOutCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/commented-out-code',
  languages: ['python'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    if (!text.startsWith('#')) return null

    const inner = text.slice(1).trim()
    if (inner.length < 10) return null

    const codePatterns = [
      /\b(def|class|import|from|return|if|for|while|try|except|with|raise|print)\b/,
      /[;()]/,
      /\w+\s*\(.*\)/,
      /=\s*\w/,
    ]

    const matchCount = codePatterns.filter((p) => p.test(inner)).length
    if (matchCount >= 2) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Commented-out code',
        'This comment appears to contain commented-out code. Remove it or track it in version control.',
        sourceCode,
        'Delete the commented-out code. If needed, it can be recovered from version control.',
      )
    }
    return null
  },
}
