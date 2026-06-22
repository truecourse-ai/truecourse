import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An interpolated string whose entire content is a single hole wrapping a
 * value that is *already a string* (`$"{name.ToString()}"`, `$"{nameof(x)}"`,
 * `$"{"text"}"`) produces exactly that string; the interpolation wrapper is
 * pure overhead (RCS1105). To stay zero-FP without a type checker, the rule
 * fires only when the inner expression is provably string-typed by its syntax:
 *   - a `.ToString()` call with no arguments,
 *   - a `nameof(...)` invocation,
 *   - a string / interpolated-string literal.
 *
 * It requires the interpolation to be the *only* segment (no surrounding text)
 * and to carry no format or alignment clause, since those change the output.
 */

function isProvablyStringExpression(expr: SyntaxNode): boolean {
  if (expr.type === 'string_literal' || expr.type === 'verbatim_string_literal' ||
      expr.type === 'raw_string_literal' || expr.type === 'interpolated_string_expression') {
    return true
  }
  if (expr.type === 'invocation_expression') {
    const fn = expr.childForFieldName('function')
    const args = expr.childForFieldName('arguments')
    if (fn?.type === 'identifier' && fn.text === 'nameof') return true
    if (fn?.type === 'member_access_expression' && fn.childForFieldName('name')?.text === 'ToString') {
      // Only the no-format overload — `ToString("X")` changes the output.
      return (args?.namedChildren.filter(Boolean).length ?? 0) === 0
    }
  }
  return false
}

export const csharpUnnecessaryStringInterpolationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-string-interpolation',
  languages: ['csharp'],
  nodeTypes: ['interpolated_string_expression'],
  visit(node, filePath, sourceCode) {
    // Reject any literal text segment around the hole.
    if (node.namedChildren.some((c) => c?.type === 'string_content' || c?.type === 'interpolated_string_text')) return null

    const interpolations = node.namedChildren.filter((c) => c?.type === 'interpolation')
    if (interpolations.length !== 1) return null
    const interp = interpolations[0]!

    // A format/alignment clause changes the rendered value — not redundant.
    if (interp.namedChildren.some((c) => c?.type === 'interpolation_format_clause' || c?.type === 'interpolation_alignment_clause')) return null

    const expr = interp.namedChildren.find((c) => c?.type !== 'interpolation_brace')
    if (!expr || !isProvablyStringExpression(expr)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary string interpolation',
      `This interpolated string wraps a single already-string value (\`${expr.text}\`); the interpolation produces exactly that value and adds only overhead (RCS1105).`,
      sourceCode,
      `Use the expression \`${expr.text}\` directly instead of interpolating it.`,
    )
  },
}
