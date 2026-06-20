import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `new T[0]` allocates a fresh empty array on every evaluation. `Array.Empty<T>()`
 * returns a shared, cached singleton — no allocation. Only flags a rank
 * specifier whose single size expression is the literal `0`; sizes given by a
 * variable or expression are left alone.
 */
export const csharpZeroLengthArrayAllocationVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/zero-length-array-allocation',
  languages: ['csharp'],
  nodeTypes: ['array_creation_expression'],
  visit(node, filePath, sourceCode) {
    const arrayType = node.childForFieldName('type')
    if (arrayType?.type !== 'array_type') return null

    const rank = arrayType.namedChildren.find((c) => c?.type === 'array_rank_specifier')
    if (!rank) return null

    const sizes = rank.namedChildren.filter(Boolean)
    if (sizes.length !== 1) return null
    if (sizes[0]!.type !== 'integer_literal' || sizes[0]!.text !== '0') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Zero-length array allocation',
      'new T[0] allocates a fresh empty array every time it runs. Array.Empty<T>() returns a shared cached instance with no allocation.',
      sourceCode,
      'Replace new T[0] with Array.Empty<T>().',
    )
  },
}
