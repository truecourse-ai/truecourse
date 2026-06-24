import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A numeric literal whose digit-group underscores are inconsistent — e.g.
 * `1_23_456` or `0xF_FF_F`. Digit separators exist to make a value readable; when
 * the interior groups are different widths the grouping maps to no base (thousands,
 * bytes, nibbles), which usually means a digit was added or dropped by mistake.
 * Only genuinely irregular grouping is flagged: a short leading group is allowed
 * (`1_000_000`), and any consistent width is accepted (`1_2345_6789`).
 */
export const csharpIrregularNumberPatternVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/irregular-number-pattern',
  languages: ['csharp'],
  nodeTypes: ['integer_literal', 'real_literal'],
  visit(node, filePath, sourceCode) {
    if (!isIrregular(node.text)) return null
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Irregular numeric digit grouping',
      `Numeric literal '${node.text}' has inconsistent digit-group separators — likely a mistyped value.`,
      sourceCode,
      'Use a consistent digit-group width, or remove the separators.',
    )
  },
}

function isIrregular(raw: string): boolean {
  if (!raw.includes('_')) return false

  const isHex = /^0x/i.test(raw)
  let s = isHex || /^0b/i.test(raw) ? raw.slice(2) : raw

  // Keep only the integer mantissa: stop at a fractional point, a decimal
  // exponent, or a trailing type suffix. Hex digits a–f are kept.
  let end = 0
  while (end < s.length) {
    const c = s[end]
    const isDigit = c >= '0' && c <= '9'
    const isHexLetter = isHex && ((c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))
    if (isDigit || isHexLetter || c === '_') { end++; continue }
    break
  }
  s = s.slice(0, end)

  const groups = s.split('_')
  // A leading/trailing/double underscore would not compile; ignore if seen.
  if (groups.some((g) => g.length === 0)) return false
  // Need at least two interior groups to be able to disagree.
  if (groups.length <= 2) return false

  const width = groups[1].length
  for (let i = 2; i < groups.length; i++) {
    if (groups[i].length !== width) return true
  }
  return false
}
