import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects `in` / `not in` operator used on a literal that doesn't
 * support membership testing.
 *
 * Examples:
 *   42 in 100         # TypeError — int is not iterable
 *   "a" in 42         # TypeError — int is not iterable
 *   "a" not in True   # TypeError — bool is not iterable
 */
export const pythonNotInOperatorIncompatibleVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/not-in-operator-incompatible',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    // Check for `in` or `not in`
    const ops = node.children.filter((c) => !c.isNamed)
    const hasIn = ops.some((c) => c.text === 'in')
    if (!hasIn) return null

    const children = node.namedChildren
    if (children.length < 2) return null

    // The container is the right operand (e.g., `x in container`)
    const container = children[1]
    if (!container) return null

    // Check if the container is a non-iterable literal
    if (isNonIterableLiteral(container)) {
      const isNot = ops.some((c) => c.text === 'not')
      const op = isNot ? 'not in' : 'in'

      return makeViolation(
        this.ruleKey,
        node,
        filePath,
        'high',
        'Membership test on non-container type',
        `Using \`${op}\` on \`${container.type}\` — \`TypeError\` at runtime because \`${container.type}\` does not support membership testing.`,
        sourceCode,
        'Use a container type (list, set, dict, string, tuple) as the right operand.',
      )
    }

    return null
  },
}

function isNonIterableLiteral(node: SyntaxNode): boolean {
  return (
    node.type === 'integer' ||
    node.type === 'float' ||
    node.type === 'true' ||
    node.type === 'false' ||
    node.type === 'none'
  )
}
