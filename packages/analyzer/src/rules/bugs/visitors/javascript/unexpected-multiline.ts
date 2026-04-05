import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const unexpectedMultilineVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unexpected-multiline',
  languages: JS_LANGUAGES,
  nodeTypes: ['return_statement'],
  visit(node, filePath, sourceCode) {
    // A bare `return` (no expression) whose token spans only one line
    if (node.namedChildren.length > 0) return null

    // Check if there's another non-empty statement immediately after on the next line
    // In tree-sitter a bare `return;` is fine, but `return` (no semicolon) with value on next line
    // gets parsed as a bare return_statement followed by an expression_statement.
    // We flag if the bare return is NOT followed by a } — i.e., there's a sibling expression
    // that might have been intended as the return value.
    const parent = node.parent
    if (!parent) return null

    const siblings = parent.namedChildren
    const idx = siblings.indexOf(node)
    if (idx < 0 || idx >= siblings.length - 1) return null

    const next = siblings[idx + 1]
    if (!next) return null

    // If the next sibling is an expression_statement on the very next line, warn
    if (next.type !== 'expression_statement' && next.type !== 'call_expression') return null

    const returnLine = node.endPosition.row
    const nextLine = next.startPosition.row

    if (nextLine === returnLine + 1) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unexpected multiline — bare return',
        'A bare `return` followed by an expression on the next line returns `undefined` due to ASI — the expression is unreachable.',
        sourceCode,
        'Either move the expression to the same line as `return`, or add `return` before the expression.',
      )
    }

    return null
  },
}
