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
    const match = text.match(/\b(TODO|FIXME|HACK)\b/i)
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
