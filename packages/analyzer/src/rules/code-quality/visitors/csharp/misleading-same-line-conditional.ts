import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Two `if` statements on the same line — `if (a) Foo(); if (b) Bar();` —
 * where the second reads like an `else` branch but isn't.
 */
export const csharpMisleadingSameLineConditionalVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/misleading-same-line-conditional',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent) return null

    let prevSibling: SyntaxNode | null = null
    for (const child of parent.children) {
      if (!child) continue
      if (child.id === node.id) break
      if (child.isNamed) prevSibling = child
    }
    if (prevSibling?.type !== 'if_statement') return null
    if (prevSibling.endPosition.row !== node.startPosition.row) return null
    if (prevSibling.childForFieldName('alternative')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Misleading same-line conditional',
      'Two `if` statements on the same line — the second may be mistaken for an `else` branch. Put each statement on its own line.',
      sourceCode,
      'Move the second `if` to a new line, or use `else if` if that was the intent.',
    )
  },
}
