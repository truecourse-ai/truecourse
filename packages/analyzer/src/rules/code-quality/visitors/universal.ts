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
    // A genuine task marker stands alone (`TODO:`, `FIXME`, `HACK(name)`). A
    // marker glued to another word by a hyphen is part of a compound — a rule
    // key like `todo-fixme`, a noun like `todo-list` — not a task to do.
    // `TODO-123` (a ticket ref) still fires: the digit isn't part of a word.
    const match = text.match(/(?<![A-Za-z]-)\b(TODO|FIXME|HACK)\b(?!-[A-Za-z])/i)
    if (!match) return null

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
