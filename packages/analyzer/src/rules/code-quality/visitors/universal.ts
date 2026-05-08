/**
 * Code quality domain language-agnostic visitors.
 */

import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

export const todoFixmeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/todo-fixme',
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Require uppercase \`TODO\`/\`FIXME\`/\`HACK\` as a real marker.
    // Lowercase \`todo\` inside a JSDoc string-literal union (e.g.,
    // \`'todo' | 'in_progress' | 'done'\`) is documenting a domain
    // value, not a marker.
    const match = text.match(/\b(TODO|FIXME|HACK)\b/)
    if (!match) return null
    // Skip when the marker is inside a quoted string-literal in a
    // JSDoc / block comment that documents an enum union (e.g.,
    // a list of single-quoted values).
    const m = text.match(/['"`][^'"`]*\b(?:TODO|FIXME|HACK|todo|fixme|hack)\b[^'"`]*['"`]/i)
    if (m && /\|/.test(text)) return null

    const tag = match[1].toUpperCase()
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `${tag} comment`,
      `${tag} comment found: ${text.trim().slice(0, 100)}`,
      sourceCode,
    )
  },
}

export const CODE_QUALITY_UNIVERSAL_VISITORS: CodeRuleVisitor[] = [
  todoFixmeVisitor,
]
