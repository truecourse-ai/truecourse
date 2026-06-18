import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Integer-valued double/float literals whose value exceeds the type's
 * mantissa — the compiler silently rounds them (`16777217f` becomes
 * 16777216, `9007199254740993.0` becomes …992).
 *
 * C# integer literals cannot silently lose precision (out-of-range values
 * are compile errors, in-range values are exact), so only real literals
 * are checked. Fractional and exponent literals are approximations by
 * nature and are not flagged.
 */
export const csharpLossOfPrecisionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/loss-of-precision',
  languages: ['csharp'],
  nodeTypes: ['real_literal'],
  visit(node, filePath, sourceCode) {
    const text = node.text.replace(/_/g, '')
    if (/[eE]/.test(text)) return null

    const suffix = /[fFdDmM]$/.exec(text)?.[0] ?? ''
    if (suffix === 'm' || suffix === 'M') return null
    const isFloat = suffix === 'f' || suffix === 'F'

    const body = suffix ? text.slice(0, -1) : text
    const [intPart = '', fracPart = ''] = body.split('.')
    if (!/^\d+$/.test(intPart)) return null
    if (fracPart && /[1-9]/.test(fracPart)) return null // fractional value — inherently approximate

    const exact = BigInt(intPart)
    const mantissaLimit = isFloat ? 1n << 24n : 1n << 53n
    if (exact <= mantissaLimit) return null

    const roundTripped = isFloat ? Math.fround(Number(intPart)) : Number(intPart)
    if (Number.isFinite(roundTripped) && BigInt(roundTripped) === exact) return null

    const typeName = isFloat ? 'float' : 'double'
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Loss of precision',
      `\`${node.text}\` exceeds the ${typeName} mantissa (${isFloat ? '2^24' : '2^53'}) and is silently rounded to ${roundTripped} at compile time.`,
      sourceCode,
      `Use a \`long\`/\`decimal\` literal if the exact integer value matters, or accept the rounding explicitly.`,
    )
  },
}
