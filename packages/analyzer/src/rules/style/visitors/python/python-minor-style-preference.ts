import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonMinorStyleVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/python-minor-style-preference',
  languages: ['python'],
  nodeTypes: ['dictionary', 'list', 'tuple', 'argument_list'],
  visit(node, filePath, sourceCode) {
    // Only check multi-line collections
    if (node.startPosition.row === node.endPosition.row) return null

    // Skip argument_list that's not multi-line function call args
    if (node.type === 'argument_list' && node.namedChildren.length < 2) return null

    const children = node.namedChildren
    if (children.length === 0) return null

    const lastChild = children[children.length - 1]
    if (!lastChild) return null

    // Check if there's a comma after the last element
    const textAfterLastChild = sourceCode.substring(lastChild.endIndex, node.endIndex)
    const hasTrailingComma = textAfterLastChild.trimStart().startsWith(',')

    if (!hasTrailingComma && node.endPosition.row > lastChild.endPosition.row) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Missing trailing comma in multi-line collection',
        'Multi-line collection/function call without a trailing comma. Adding one makes diffs cleaner.',
        sourceCode,
        'Add a trailing comma after the last element.',
      )
    }

    return null
  },
}
