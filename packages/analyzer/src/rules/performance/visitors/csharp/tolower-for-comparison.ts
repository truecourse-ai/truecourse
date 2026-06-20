import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * `a.ToLower() == b.ToLower()` (or `ToUpper`) allocates two lowercased strings
 * just to compare them case-insensitively. `string.Equals(a, b,
 * StringComparison.OrdinalIgnoreCase)` compares in place with no allocation.
 * Fires only when BOTH operands of an equality test are parameterless
 * `ToLower`/`ToUpper` calls — parameterless ToLower/ToUpper is string-specific.
 */
const CASE_METHODS = new Set(['ToLower', 'ToUpper', 'ToLowerInvariant', 'ToUpperInvariant'])

function isParameterlessCaseCall(node: SyntaxNode): boolean {
  if (node.type !== 'invocation_expression') return false
  if (!CASE_METHODS.has(getCSharpMethodName(node))) return false
  return getCSharpArguments(node).length === 0
}

export const csharpToLowerForComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/tolower-for-comparison',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text
    if (op !== '==' && op !== '!=') return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null
    if (!isParameterlessCaseCall(left) || !isParameterlessCaseCall(right)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'ToLower/ToUpper for case-insensitive compare',
      'Lowercasing (or uppercasing) both operands to compare them case-insensitively allocates two throwaway strings on every comparison. A StringComparison overload compares in place with no allocation.',
      sourceCode,
      'Use string.Equals(a, b, StringComparison.OrdinalIgnoreCase) instead of comparing ToLower()/ToUpper() results.',
    )
  },
}
