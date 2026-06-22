import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A rectangular multidimensional array (`T[,]`) is bounds-checked on every
 * access and rarely the shape callers expect; a jagged array (`T[][]`) or a
 * dedicated collection is usually clearer and faster. A rank specifier is
 * multidimensional when it declares more than one dimension (a comma between
 * the brackets). Jagged arrays nest separate single-dimension specifiers and
 * are not flagged.
 */
export const csharpMultidimensionalArrayVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/multidimensional-array',
  languages: ['csharp'],
  nodeTypes: ['array_type'],
  visit(node, filePath, sourceCode) {
    const rank = node.namedChildren.find((c) => c?.type === 'array_rank_specifier')
    if (!rank) return null

    // A jagged array nests an inner array_type; a multidimensional one does
    // not. Dimensions are the commas: `[,]` → text contains a comma, or two+
    // size expressions for a sized creation (`new int[3,3]`).
    const isMultidim = rank.text.includes(',') || rank.namedChildren.filter(Boolean).length > 1
    if (!isMultidim) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Multidimensional array',
      'A rectangular multidimensional array (T[,]) is bounds-checked on every element access and is rarely the intended design. A jagged array (T[][]) or a dedicated collection is usually clearer and faster.',
      sourceCode,
      'Use a jagged array (T[][]) or a collection type instead of a rectangular multidimensional array.',
    )
  },
}
