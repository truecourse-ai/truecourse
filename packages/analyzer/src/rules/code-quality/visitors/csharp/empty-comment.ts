import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A comment marker with no content (an empty line comment or an empty block
 * comment) is pure noise — a leftover after the text was deleted. A line
 * consisting only of repeated punctuation (a section divider) is a deliberate
 * visual separator and is not flagged.
 */

function commentBody(text: string): string {
  if (text.startsWith('///')) return text.slice(3)
  if (text.startsWith('//')) return text.slice(2)
  if (text.startsWith('/*')) return text.replace(/^\/\*+/, '').replace(/\*+\/$/, '')
  return text
}

// A divider line is one whose entire content is a run of a single punctuation
// char (e.g. `------`, `======`, `######`).
const DIVIDER = /^[-=*#~_]{2,}$/

export const csharpEmptyCommentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-comment',
  languages: ['csharp'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const body = commentBody(node.text).trim()
    if (body.length > 0 && !DIVIDER.test(body)) return null
    if (DIVIDER.test(body)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Empty comment',
      'This comment marker carries no text and is pure noise.',
      sourceCode,
      'Remove the empty comment.',
    )
  },
}
