import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonStringFormatMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/string-format-mismatch',
  languages: ['python'],
  nodeTypes: ['binary_operator'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.text === '%')
    if (!op) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    // Only check string literals on the left
    if (left.type !== 'string') return null

    const fmt = left.text.slice(1, -1) // strip quotes

    // Count %s, %d, %f, %r, %x, %o, %e, %g, %c, %i (but not %% which is literal %)
    const placeholders = (fmt.match(/%[^%sdfrxoegci]/g) || []).length
    const realPlaceholders = (fmt.match(/%[sdfrxoegci]/g) || []).length

    if (realPlaceholders === 0) return null // no format placeholders

    // Count the right-hand side arguments
    let argCount = 0
    if (right.type === 'tuple') {
      argCount = right.namedChildren.length
    } else {
      // Single value
      argCount = 1
    }

    if (realPlaceholders !== argCount) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'String format argument count mismatch',
        `Format string has ${realPlaceholders} placeholder(s) but ${argCount} argument(s) were provided — this will raise a TypeError at runtime.`,
        sourceCode,
        `Provide exactly ${realPlaceholders} argument(s) for the format string.`,
      )
    }

    return null
  },
}
