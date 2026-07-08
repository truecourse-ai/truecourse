import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isCommentedOutCode, lineCommentRunInner } from '../_shared/commented-out-code.js'

// A `//` line comment, excluding `///` (which the TS grammar still emits as `//`).
const isLineComment = (t: string): boolean => t.startsWith('//')

export const commentedOutCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/commented-out-code',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text

    if (text.startsWith('/**')) return null

    let inner: string | null
    if (isLineComment(text)) {
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
