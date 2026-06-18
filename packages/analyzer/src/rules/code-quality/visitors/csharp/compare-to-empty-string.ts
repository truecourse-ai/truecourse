import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function isEmptyStringExpr(n: SyntaxNode): boolean {
  if (n.type === 'string_literal') {
    return !n.namedChildren.some((c) => c?.type === 'string_literal_content' || c?.type === 'escape_sequence')
  }
  if (n.type === 'member_access_expression') {
    const recv = n.childForFieldName('expression')?.text
    return (recv === 'string' || recv === 'String') && n.childForFieldName('name')?.text === 'Empty'
  }
  return false
}

/**
 * `x == ""` / `x == string.Empty` — `string.IsNullOrEmpty(x)` (or
 * `x.Length == 0`) is the .NET idiom (CA1820). Note the semantic widening:
 * IsNullOrEmpty also accepts null, where `== ""` is false for null — the
 * message says so because the fix must choose deliberately.
 */
export const csharpCompareToEmptyStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/compare-to-empty-string',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text
    if (op !== '==' && op !== '!=') return null
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null
    if (!isEmptyStringExpr(left) && !isEmptyStringExpr(right)) return null
    // `"" == ""` etc. is comparison-of-constant territory.
    if (isEmptyStringExpr(left) && isEmptyStringExpr(right)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Comparison to empty string',
      `\`${op} ""\` — prefer \`string.IsNullOrEmpty(x)\` (note: it also matches null, unlike \`== ""\`) or \`x.Length == 0\` when null is impossible (CA1820).`,
      sourceCode,
      'Replace with `string.IsNullOrEmpty(x)` if null should count as empty, or `x.Length == 0` if x is known non-null.',
    )
  },
}
