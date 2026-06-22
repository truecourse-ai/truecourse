import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An accidentally repeated word in a comment ("the the", "is is") is a typo
 * that signals careless editing and sometimes hides a dropped word. Matching is
 * deliberately conservative: only alphabetic words of three or more letters
 * repeated back-to-back (case-insensitively) count, which excludes legitimate
 * doubled tokens like `// // `, `1 1`, or short particles.
 */

const DUP_WORD = /\b([A-Za-z]{3,})\s+\1\b/i

// Common technical doubles that are intentional, not typos.
const ALLOWED = new Set(['that that', 'had had'])

function stripMarkers(text: string): string {
  return text
    .replace(/^\/\/\/?/, '')
    .replace(/^\/\*+/, '')
    .replace(/\*+\/$/, '')
}

export const csharpDuplicateWordInCommentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-word-in-comment',
  languages: ['csharp'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const body = stripMarkers(node.text)
    const m = DUP_WORD.exec(body)
    if (!m) return null
    if (ALLOWED.has(m[0].toLowerCase())) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Duplicate word in comment',
      `The comment repeats the word "${m[1]}" back-to-back, which is almost always a typo.`,
      sourceCode,
      'Remove the duplicated word (or restore the word that was meant to follow it).',
    )
  },
}
