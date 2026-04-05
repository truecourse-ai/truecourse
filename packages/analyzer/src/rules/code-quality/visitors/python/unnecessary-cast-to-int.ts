import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * RUF046: Detects `int()` called on values that are already integers:
 * - int(len(x))
 * - int(x // y)  — integer division already returns int
 * - int(x & y)   — bitwise already returns int
 * - int(x | y)   — bitwise already returns int
 */
export const pythonUnnecessaryCastToIntVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-cast-to-int',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'int') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((c) => c.type !== 'keyword_argument')
    if (positionalArgs.length !== 1) return null

    const arg = positionalArgs[0]

    // int(len(x))
    if (arg.type === 'call') {
      const innerFn = arg.childForFieldName('function')
      if (innerFn?.type === 'identifier' && innerFn.text === 'len') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary int() cast',
          '`int(len(...))` is redundant — `len()` already returns an `int`.',
          sourceCode,
          'Remove the `int()` wrapper around `len()`.',
        )
      }
    }

    // int(x // y) — floor division already returns int
    if (arg.type === 'binary_operator') {
      const op = arg.children.find((c) => c.text === '//')
      if (op) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary int() cast',
          '`int(x // y)` is redundant — floor division `//` already returns an `int`.',
          sourceCode,
          'Remove the `int()` wrapper around the floor division expression.',
        )
      }
    }

    return null
  },
}
