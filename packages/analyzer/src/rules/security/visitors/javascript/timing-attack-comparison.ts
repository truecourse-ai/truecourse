import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const SENSITIVE_COMPARISON_PATTERNS = /(?:token|secret|hmac|signature|apikey|api_key|hash|digest|password|passwd)/i

const TYPEOF_RETURN_VALUES = new Set([
  'string', 'number', 'boolean', 'object', 'undefined', 'function', 'symbol', 'bigint',
])

function isTypeofExpression(node: SyntaxNode): boolean {
  return node.type === 'unary_expression' && node.children.some((c) => c.text === 'typeof')
}

function isTypeofReturnLiteral(node: SyntaxNode): boolean {
  if (node.type !== 'string') return false
  const inner = node.text.slice(1, -1)
  return TYPEOF_RETURN_VALUES.has(inner)
}

function isLengthAccess(node: SyntaxNode): boolean {
  if (node.type !== 'member_expression') return false
  const prop = node.childForFieldName('property')
  return prop?.text === 'length'
}

const ENUM_CONSTANT_PATTERN = /^[A-Z][A-Z0-9_]*$/

/**
 * Return true if the node is a clearly non-secret constant: a boolean
 * literal, null/undefined, an UPPER_SNAKE_CASE identifier (typical enum
 * value), or a member access whose final property is UPPER_SNAKE_CASE
 * (e.g. `FieldType.SIGNATURE`). Timing attacks require both sides to be
 * unknown to the attacker; when one side is a publicly-known constant,
 * the compare leaks nothing.
 */
function isClearConstantValue(node: SyntaxNode): boolean {
  if (node.type === 'true' || node.type === 'false') return true
  if (node.type === 'null') return true
  if (node.type === 'undefined') return true
  if (node.type === 'identifier') {
    if (node.text === 'undefined') return true
    if (ENUM_CONSTANT_PATTERN.test(node.text)) return true
    return false
  }
  if (node.type === 'member_expression') {
    const prop = node.childForFieldName('property')
    if (prop?.text && ENUM_CONSTANT_PATTERN.test(prop.text)) return true
  }
  return false
}

/**
 * Return the most specific identifier on this side of a comparison — the
 * variable name for a plain identifier, the final property segment for a
 * member access, or the string literal for `obj['x-api-key']`-style
 * subscripts. The sensitive-name check runs against the leaf so a parent
 * path like `decodedToken.scope` is not flagged just because it contains
 * the word "token".
 */
function leafIdentifier(node: SyntaxNode): string {
  if (node.type === 'identifier') return node.text
  if (node.type === 'member_expression') {
    const prop = node.childForFieldName('property')
    if (prop?.text) return prop.text
  }
  if (node.type === 'subscript_expression') {
    const index = node.childForFieldName('index')
    if (index?.type === 'string') return index.text.slice(1, -1)
    if (index?.text) return index.text
  }
  return node.text
}

export const timingAttackComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/timing-attack-comparison',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.type === '===' || c.type === '!==')

    if (!operator || !left || !right) return null

    // Skip type guards: `typeof X === 'string'`, `typeof X !== 'number'`, etc.
    if (isTypeofExpression(left) || isTypeofExpression(right)) return null
    if (isTypeofReturnLiteral(left) || isTypeofReturnLiteral(right)) return null

    // Skip `.length` comparisons (structural, not value-of-secret).
    if (isLengthAccess(left) || isLengthAccess(right)) return null

    // Skip comparisons against numeric literals (length / count checks).
    if (left.type === 'number' || right.type === 'number') return null

    // Skip when one side is a clear public constant — boolean literal,
    // null/undefined, or an UPPER_SNAKE_CASE enum value. A timing attack
    // requires both sides to be secret to the attacker.
    if (isClearConstantValue(left) || isClearConstantValue(right)) return null

    // Apply the sensitive-name check against the leaf identifier so that
    // member access paths like `decodedToken.scope` are recognized by
    // their final segment (`scope`) rather than by ancestor names that
    // happen to contain a sensitive word.
    const leftLeaf = leafIdentifier(left)
    const rightLeaf = leafIdentifier(right)

    if (SENSITIVE_COMPARISON_PATTERNS.test(leftLeaf) || SENSITIVE_COMPARISON_PATTERNS.test(rightLeaf)) {
      // Skip if the file already uses timingSafeEqual — the === is likely a format check, not a secret comparison
      if (sourceCode.includes('timingSafeEqual')) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Timing attack via string comparison',
        `Using ${operator.text} to compare what may be a secret/token. This is vulnerable to timing attacks.`,
        sourceCode,
        'Use crypto.timingSafeEqual() for comparing secrets and tokens.',
      )
    }

    return null
  },
}
