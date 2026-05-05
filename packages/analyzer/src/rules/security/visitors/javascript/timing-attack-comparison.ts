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
