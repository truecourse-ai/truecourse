import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Keywords that, in a hand-built query, are normally followed by an identifier or
// value — so a literal ending here with no trailing space jams the keyword onto the
// concatenated fragment (`"… FROM" + table` → `"FROMusers"`).
const TRAILING_KEYWORDS = /\b(FROM|INTO|JOIN|WHERE|SET|VALUES|AND|OR|ON|LIKE|IN|EXEC|EXECUTE|HAVING|BY)$/i
// A literal is only treated as SQL if it carries a command verb — keeps the rule off
// ordinary prose that happens to end on a word like "in" or "by".
const SQL_VERB = /\b(SELECT|INSERT|UPDATE|DELETE|MERGE|FROM|WHERE)\b/i

/**
 * A hand-built SQL string that concatenates a keyword directly onto the next
 * fragment with no separating space — e.g. <c>"SELECT * FROM" + table</c> produces
 * <c>"…FROMusers"</c>, invalid SQL that fails at runtime (and often masks an
 * injection-prone concatenation besides). Flagged only when the left literal is
 * recognizably SQL and ends on a keyword with no trailing space, and the right
 * fragment does not itself start with one.
 */
export const csharpSqlKeywordNotDelimitedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/sql-keyword-not-delimited',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('operator')?.text !== '+') return null

    const left = node.childForFieldName('left')
    const leftText = stringContent(left)
    if (leftText === null) return null
    if (!SQL_VERB.test(leftText) || !TRAILING_KEYWORDS.test(leftText.trimEnd()) || /\s$/.test(leftText)) return null

    // If the right fragment is itself a literal starting with whitespace, the space
    // is present after all — not a defect.
    const right = node.childForFieldName('right')
    const rightText = stringContent(right)
    if (rightText !== null && /^\s/.test(rightText)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'SQL keyword concatenated without a delimiter',
      'A SQL keyword is concatenated directly onto the next fragment with no separating space, producing invalid SQL — add a trailing space inside the literal.',
      sourceCode,
      'Add a trailing space after the keyword inside the string literal.',
    )
  },
}

/** The text inside a (regular or verbatim) string literal, or null if not one. */
function stringContent(node: SyntaxNode | null): string | null {
  if (!node) return null
  if (node.type === 'string_literal') return node.text.replace(/^"/, '').replace(/"$/, '')
  if (node.type === 'verbatim_string_literal') return node.text.replace(/^@"/, '').replace(/"$/, '')
  return null
}
