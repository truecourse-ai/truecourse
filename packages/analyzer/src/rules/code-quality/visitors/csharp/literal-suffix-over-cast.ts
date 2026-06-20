import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Target type → the literal suffix that expresses it directly. */
const SUFFIX_FOR_TYPE: Record<string, string> = {
  long: 'L',
  ulong: 'UL',
  uint: 'U',
  float: 'F',
  double: 'D',
  decimal: 'M',
}

/**
 * Casting a numeric literal — `(long)1`, `(float)2` — to set its type reads
 * like a runtime conversion when a literal suffix (`1L`, `2f`) states the type
 * directly with no cast at all (SA1139). Matched on a `cast_expression` to a
 * predefined numeric type whose value is a bare integer/real literal; casts of
 * non-literals (real conversions) are untouched.
 */
export const csharpLiteralSuffixOverCastVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/literal-suffix-over-cast',
  languages: ['csharp'],
  nodeTypes: ['cast_expression'],
  visit(node, filePath, sourceCode) {
    const typeNode = node.childForFieldName('type')
    if (typeNode?.type !== 'predefined_type') return null
    const suffix = SUFFIX_FOR_TYPE[typeNode.text]
    if (!suffix) return null

    const value = node.childForFieldName('value')
    if (value?.type !== 'integer_literal' && value?.type !== 'real_literal') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use literal suffix instead of cast',
      `\`(${typeNode.text})${value.text}\` casts a literal where the suffix \`${value.text}${suffix}\` expresses the type directly and avoids a runtime-looking cast (SA1139).`,
      sourceCode,
      `Replace the cast with the literal suffix (e.g. \`${value.text}${suffix}\`).`,
    )
  },
}
