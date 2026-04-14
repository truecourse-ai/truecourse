import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects map() calls without explicit strict parameter (Python 3.14+).
 * Without strict=True, map() silently truncates when iterables differ in length.
 * Note: This is a forward-looking rule for Python 3.14.
 */
export const pythonMapWithoutStrictVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/map-without-strict',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func || func.type !== 'identifier' || func.text !== 'map') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((a) => a.type !== 'keyword_argument')

    // map(func, *iterables) — only relevant when multiple iterables passed
    if (positionalArgs.length < 3) return null

    // Check if `strict` keyword argument is present
    const hasStrict = args.namedChildren.some((arg) => {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')
        return key?.text === 'strict'
      }
      return false
    })

    if (!hasStrict) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'map() without explicit strict parameter',
        `\`map()\` is called with multiple iterables but no \`strict\` parameter — when iterables have different lengths, the shorter one silently truncates the result.`,
        sourceCode,
        `Add \`strict=True\` to raise a \`ValueError\` if the iterables have different lengths: \`map(fn, iter1, iter2, strict=True)\`.`,
      )
    }

    return null
  },
}
