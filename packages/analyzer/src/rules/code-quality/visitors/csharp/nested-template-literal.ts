import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function containsInterpolatedString(n: SyntaxNode): boolean {
  if (n.type === 'interpolated_string_expression') return true
  for (const child of n.namedChildren) {
    if (child && containsInterpolatedString(child)) return true
  }
  return false
}

/**
 * Interpolated string inside another interpolated string's hole on a single
 * line — `$"a{$"b{x}"}c"` reads as brace soup. Multi-line builders already
 * read vertically and are left alone, mirroring the JS visitor.
 */
export const csharpNestedTemplateLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-template-literal',
  languages: ['csharp'],
  nodeTypes: ['interpolated_string_expression'],
  visit(node, filePath, sourceCode) {
    // Only the outermost interpolated string reports.
    let ancestor = node.parent
    while (ancestor) {
      if (ancestor.type === 'interpolated_string_expression') return null
      ancestor = ancestor.parent
    }
    if (node.startPosition.row !== node.endPosition.row) return null

    for (const child of node.namedChildren) {
      if (child?.type !== 'interpolation') continue
      if (containsInterpolatedString(child)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Nested interpolated string',
          'Interpolated string inside another interpolated string is hard to read. Extract the inner expression to a variable.',
          sourceCode,
          'Extract the inner interpolated string to a local variable.',
        )
      }
    }
    return null
  },
}
