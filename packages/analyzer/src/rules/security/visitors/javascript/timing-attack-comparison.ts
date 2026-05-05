import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const SENSITIVE_COMPARISON_PATTERNS = /(?:token|secret|hmac|signature|apikey|api_key|hash|digest|password|passwd)/i

// Heuristic: when one side of `===` / `!==` is an enum-shaped reference
// (string literal that's a SCREAMING_SNAKE identifier, or a member access
// on a Type-style object whose property is also SCREAMING_SNAKE), the
// comparison is a field-type / state-tag check, not a credential
// comparison. Real credentials don't appear as `'TOKEN'` literals or
// `FieldType.SIGNATURE` references — those are dispatch keys.
function isEnumLikeReference(node: SyntaxNode): boolean {
  if (node.type === 'string') {
    const inner = node.text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')
    if (/^[A-Z][A-Z0-9_]*$/.test(inner)) return true
  }
  if (node.type === 'member_expression') {
    const property = node.childForFieldName('property')
    if (property && /^[A-Z][A-Z0-9_]*$/.test(property.text)) return true
  }
  return false
}

// Presence/state checks: `signature !== ''`, `token === null`,
// `enabled === false`, `length === 0`. These compare against a
// non-credential sentinel — empty string, null, undefined, boolean,
// or number literal. No timing-attack risk because the operand carries
// no secret material.
function isPresenceCheckOperand(node: SyntaxNode): boolean {
  // Empty-string literal: `""`, `''`, ``
  if (node.type === 'string') {
    const inner = node.text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')
    if (inner === '') return true
  }
  // Numeric literal: `0`, `1`, etc.
  if (node.type === 'number') return true
  // null / undefined / true / false
  if (node.type === 'null') return true
  if (node.type === 'undefined') return true
  if (node.type === 'true' || node.type === 'false') return true
  // identifier `null` / `undefined` (sometimes parsed as identifier)
  if (node.type === 'identifier' && (node.text === 'null' || node.text === 'undefined' || node.text === 'true' || node.text === 'false')) return true
  return false
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

    // Check if either side references a sensitive variable name
    const leftText = left.text
    const rightText = right.text

    if (SENSITIVE_COMPARISON_PATTERNS.test(leftText) || SENSITIVE_COMPARISON_PATTERNS.test(rightText)) {
      // Skip if the file already uses timingSafeEqual — the === is likely a format check, not a secret comparison
      if (sourceCode.includes('timingSafeEqual')) return null
      // Skip enum-tag / state-key comparisons: `field.type === FieldType.SIGNATURE`
      // or `selected === 'SIGNATURE'` — those are dispatch checks, not credentials.
      if (isEnumLikeReference(left) || isEnumLikeReference(right)) return null
      // Skip presence/state checks: `signature !== ''`, `token === null`,
      // `enabled === false`, `length === 0`. Sentinel operand carries no secret.
      if (isPresenceCheckOperand(left) || isPresenceCheckOperand(right)) return null
      // Skip object identity comparisons via `.id`: `token.id === otherToken.id`
      // — IDs are application-controlled, not credentials.
      if (left.type === 'member_expression' && left.childForFieldName('property')?.text === 'id') return null
      if (right.type === 'member_expression' && right.childForFieldName('property')?.text === 'id') return null
      // Skip `.length` comparisons (`signatureTypes.length === 0`).
      if (left.type === 'member_expression' && left.childForFieldName('property')?.text === 'length') return null
      if (right.type === 'member_expression' && right.childForFieldName('property')?.text === 'length') return null
      // Skip self-compare: `data.password === data.repeatedPassword`.
      // Both sides root in the same object → local form validation, no
      // remote attacker, no timing-attack surface.
      if (
        left.type === 'member_expression' && right.type === 'member_expression' &&
        left.childForFieldName('object')?.text === right.childForFieldName('object')?.text
      ) return null
      // Skip `typeof <X> === '<primitiveTypeName>'` — type checks always
      // compare a primitive type-name string, never a credential value.
      if (left.type === 'unary_expression' && left.children[0]?.text === 'typeof') return null
      if (right.type === 'unary_expression' && right.children[0]?.text === 'typeof') return null
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
