import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, isCSharpStringNode } from '../../../_shared/csharp-helpers.js'

/** `s.Substring(0, n)` — a prefix slice. */
function isPrefixSubstring(n: SyntaxNode): boolean {
  if (n.type !== 'invocation_expression') return false
  if (getCSharpMethodName(n) !== 'Substring') return false
  const args = n.childForFieldName('arguments')?.namedChildren ?? []
  if (args.length !== 2) return false
  return args[0]?.namedChildren[0]?.text === '0'
}

/** Existence-style `s.IndexOf(x)` (1 arg, or 2 with a StringComparison). */
function isPlainIndexOf(n: SyntaxNode): boolean {
  if (n.type !== 'invocation_expression') return false
  if (getCSharpMethodName(n) !== 'IndexOf') return false
  const args = n.childForFieldName('arguments')?.namedChildren ?? []
  if (args.length === 1) return true
  if (args.length === 2) return (args[1]?.text ?? '').includes('StringComparison')
  return false
}

/**
 * Prefix tests spelled the long way:
 *   - `s.Substring(0, n) == "lit"` → `s.StartsWith("lit")`
 *   - `s.IndexOf(x) == 0`          → `s.StartsWith(x)`
 */
export const csharpSubstringOverStartsEndsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/substring-over-starts-ends',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text
    if (op !== '==' && op !== '!=') return null
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const substringSide = isPrefixSubstring(left) ? left : isPrefixSubstring(right) ? right : null
    if (substringSide) {
      const other = substringSide === left ? right : left
      if (isCSharpStringNode(other)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Prefer StartsWith()',
          '`Substring(0, n) == "…"` allocates a new string just to compare a prefix — `StartsWith` checks it in place.',
          sourceCode,
          'Replace `s.Substring(0, n) == "lit"` with `s.StartsWith("lit")`.',
        )
      }
      return null
    }

    const indexOfSide = isPlainIndexOf(left) ? left : isPlainIndexOf(right) ? right : null
    if (!indexOfSide) return null
    const other = indexOfSide === left ? right : left
    if (other.type !== 'integer_literal' || other.text !== '0') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer StartsWith()',
      '`IndexOf(x) == 0` scans the whole string to test a prefix — `StartsWith(x)` states the intent and stops early.',
      sourceCode,
      'Replace `s.IndexOf(x) == 0` with `s.StartsWith(x)`.',
    )
  },
}
