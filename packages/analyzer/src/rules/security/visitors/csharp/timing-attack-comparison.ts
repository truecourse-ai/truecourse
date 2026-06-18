import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { binaryOperator, lastSegment } from './_helpers.js'

/**
 * Secrets compared with ==/!= instead of
 * CryptographicOperations.FixedTimeEquals. Only flags comparisons where BOTH
 * sides are runtime values (identifiers/member accesses) and one side's leaf
 * name is secret-like — comparisons against literals/null/enum constants are
 * public-value checks, not timing-attack targets, and identifiers like
 * `tokenType`/`tokenName` are descriptors rather than secrets.
 */
const SENSITIVE_LEAF_PATTERN = /(?:token|secret|hmac|signature|api_?key|hash|digest|password|passwd)/i
const DESCRIPTOR_SUFFIX_PATTERN = /(?:type|kind|name|scheme|id|count|length|prefix|header|algorithm|alg|format|provider|url|uri|path|endpoint)$/i
const ENUM_CONSTANT_PATTERN = /^[A-Z][A-Z0-9_]*$/

function isRuntimeValue(node: SyntaxNode): boolean {
  return node.type === 'identifier' || node.type === 'member_access_expression' || node.type === 'element_access_expression'
}

/**
 * `Type.Member` accesses (uppercase receiver: CancellationToken.None,
 * StringComparison.Ordinal, JwtConstants.TokenType) are public constants —
 * comparing against them leaks nothing.
 */
function isTypeConstantAccess(node: SyntaxNode): boolean {
  if (node.type !== 'member_access_expression') return false
  const receiver = lastSegment(node.childForFieldName('expression')?.text ?? '')
  return /^[A-Z]/.test(receiver)
}

function leafName(node: SyntaxNode): string {
  if (node.type === 'identifier') return node.text
  if (node.type === 'member_access_expression') return node.childForFieldName('name')?.text ?? node.text
  if (node.type === 'element_access_expression') {
    const args = node.namedChildren.find((c) => c?.type === 'bracketed_argument_list')
    return args?.text.replace(/[[\]"']/g, '') ?? node.text
  }
  return node.text
}

export const csharpTimingAttackComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/timing-attack-comparison',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = binaryOperator(node)
    if (op !== '==' && op !== '!=') return null

    const left = node.childForFieldName('left') ?? node.namedChildren[0]
    const right = node.childForFieldName('right') ?? node.namedChildren[1]
    if (!left || !right) return null

    // Both sides must be runtime values — null/literal/enum comparisons are public checks.
    if (!isRuntimeValue(left) || !isRuntimeValue(right)) return null

    if (isTypeConstantAccess(left) || isTypeConstantAccess(right)) return null

    const leftLeaf = leafName(left)
    const rightLeaf = leafName(right)
    if (leftLeaf === 'Length' || rightLeaf === 'Length') return null
    if (ENUM_CONSTANT_PATTERN.test(leftLeaf) || ENUM_CONSTANT_PATTERN.test(rightLeaf)) return null
    // CancellationToken comparisons are flow control, not secrets.
    if (/cancellation/i.test(leftLeaf) || /cancellation/i.test(rightLeaf)) return null

    const sensitive = [leftLeaf, rightLeaf].some(
      (leaf) => SENSITIVE_LEAF_PATTERN.test(leaf) && !DESCRIPTOR_SUFFIX_PATTERN.test(leaf),
    )
    if (!sensitive) return null

    // The file already uses constant-time comparison — this == is likely a
    // format/shape check around it.
    if (sourceCode.includes('FixedTimeEquals')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Timing attack via string comparison',
      `Comparing what looks like a secret ("${SENSITIVE_LEAF_PATTERN.test(leftLeaf) ? leftLeaf : rightLeaf}") with ${op}. Early-exit comparison leaks matching prefixes through timing.`,
      sourceCode,
      'Use CryptographicOperations.FixedTimeEquals() to compare secrets and tokens.',
    )
  },
}
