import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isCommentedOutCode, lineCommentRunInner } from '../_shared/commented-out-code.js'

// A `//` line comment, excluding `///` XML doc comments.
const isLineComment = (t: string): boolean => t.startsWith('//') && !t.startsWith('///')

export const csharpCommentedOutCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/commented-out-code',
  languages: ['csharp'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text

    // XML doc comments (`///`, `/** */`) are documentation, not code.
    if (text.startsWith('///') || text.startsWith('/**')) return null

    let inner: string | null
    if (isLineComment(text)) {
      // Evaluate the whole contiguous `//` run at its head so a multi-line
      // instructional block is judged as a block, not line by line.
      inner = lineCommentRunInner(node, { isLineComment, strip: (t) => t.replace(/^\/\/+/, '') })
      if (inner === null) return null
    } else if (text.startsWith('/*')) {
      inner = text.slice(2, -2)
    } else {
      return null
    }

    if (inner.trim().length < 10) return null

    if (isCommentedOutCode(inner, {})) {
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
