import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isCommentedOutCode, lineCommentRunInner } from '../_shared/commented-out-code.js'

const isLineComment = (t: string): boolean => t.startsWith('#')

export const pythonCommentedOutCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/commented-out-code',
  languages: ['python'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    if (!isLineComment(text)) return null

    // Group the contiguous `#` run so a multi-line block is judged together.
    const inner = lineCommentRunInner(node, { isLineComment, strip: (t) => t.replace(/^#+/, '') })
    if (inner === null) return null
    if (inner.trim().length < 10) return null

    if (isCommentedOutCode(inner, { colonTerminates: true })) {
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
