import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const commentedOutCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/commented-out-code',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text

    if (text.startsWith('/**')) return null

    let inner = text
    if (inner.startsWith('//')) inner = inner.slice(2).trim()
    else if (inner.startsWith('/*')) inner = inner.slice(2, -2).trim()

    if (inner.length < 10) return null

    const codePatterns = [
      /^\s*(const|let|var|function|return|if|for|while|import|export|class|throw|try|catch)\s/,
      /[;{}]\s*$/,
      /=>/,
      /\w+\(.*\)\s*[;{]?\s*$/,
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
