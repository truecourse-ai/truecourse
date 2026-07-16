import type { Node as SyntaxNode } from 'web-tree-sitter'
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

// A `//` line comment, excluding `///` XML doc comments.
const isLineComment = (t: string): boolean => t.startsWith('//') && !t.startsWith('///')

/**
 * An empty `//` line that sits between two non-empty `//` lines is a deliberate
 * paragraph separator inside a multi-line line-comment block (the blank `//`
 * keeps the block visually contiguous), not stray noise. It is a separator only
 * when *both* the row above and the row below are non-empty `//` (not `///`)
 * line comments; a trailing/leading blank `//` next to code still fires.
 */
function isParagraphSeparator(node: SyntaxNode): boolean {
  const row = node.startPosition.row
  const contentSibling = (n: SyntaxNode | null, atRow: number): boolean =>
    n != null &&
    n.type === 'comment' &&
    isLineComment(n.text) &&
    n.startPosition.row === atRow &&
    commentBody(n.text).trim().length > 0
  return contentSibling(node.previousSibling, row - 1) && contentSibling(node.nextSibling, row + 1)
}

export const csharpEmptyCommentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-comment',
  languages: ['csharp'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const body = commentBody(node.text).trim()
    if (body.length > 0 && !DIVIDER.test(body)) return null
    if (DIVIDER.test(body)) return null

    // A blank `//` between two content `//` lines is a paragraph break, not noise.
    if (isLineComment(node.text) && isParagraphSeparator(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Empty comment',
      'This comment marker carries no text and is pure noise.',
      sourceCode,
      'Remove the empty comment.',
    )
  },
}
