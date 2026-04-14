import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects __slots__ defined as a single string instead of an iterable.
 * e.g., __slots__ = "name"  (creates per-character slots)
 * Should be: __slots__ = ("name",) or __slots__ = ["name"]
 */
export const pythonSingleStringSlotsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/single-string-slots',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (!left || !right) return null

    // Check left side is __slots__
    if (left.type !== 'identifier' || left.text !== '__slots__') return null

    // Check if right side is a string literal
    if (right.type !== 'string') return null

    const value = right.text
    // Strip quotes to check it's a proper string (not a comment-like structure)
    const strippedValue = value.replace(/^["'r]+|["']+$/g, '')

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      '__slots__ defined as a single string',
      `\`__slots__ = ${value}\` is a string, not an iterable — Python will iterate over each character, creating per-character slots (\`${strippedValue.split('').slice(0, 3).join('', )}\`, ...) instead of a single slot.`,
      sourceCode,
      `Use a tuple or list: \`__slots__ = ("${strippedValue}",)\` or \`__slots__ = ["${strippedValue}"]\`.`,
    )
  },
}
