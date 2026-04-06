import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * RUF057: Detects `round()` called on integer literals — has no effect.
 * e.g.:
 *   round(42)      # unnecessary
 *   round(42, 2)   # unnecessary
 */
export const pythonUnnecessaryRoundVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-round',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'round') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((c) => c.type !== 'keyword_argument')
    if (positionalArgs.length === 0) return null

    const firstArg = positionalArgs[0]

    // Check if first argument is an integer literal
    if (firstArg.type === 'integer') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary round() call',
        `\`round(${firstArg.text})\` has no effect — rounding an integer literal always returns the same integer.`,
        sourceCode,
        `Replace \`round(${firstArg.text})\` with just \`${firstArg.text}\`.`,
      )
    }

    return null
  },
}
