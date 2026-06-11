import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const CODE_PATTERNS = [
  /^\s*(var|int|string|bool|double|decimal|long|float|return|if|for|foreach|while|using|throw|try|catch|switch|await|new|public|private|protected|internal|static)\s/,
  /[;{}]\s*$/,
  /=>/,
  /\w+\(.*\)\s*[;{]?\s*$/,
]

export const csharpCommentedOutCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/commented-out-code',
  languages: ['csharp'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text

    // XML doc comments (`///`, `/** */`) are documentation, not code.
    if (text.startsWith('///') || text.startsWith('/**')) return null

    let inner = text
    if (inner.startsWith('//')) inner = inner.slice(2).trim()
    else if (inner.startsWith('/*')) inner = inner.slice(2, -2).trim()

    if (inner.length < 10) return null

    const matchCount = CODE_PATTERNS.filter((p) => p.test(inner)).length
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
