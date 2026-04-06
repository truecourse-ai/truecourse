import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnecessaryListCastVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/unnecessary-list-cast',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'list') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'list_comprehension') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary list() around list comprehension',
        'list([... for ...]) is redundant. A list comprehension already returns a list.',
        sourceCode,
        'Remove the outer list() call and use the list comprehension directly.',
      )
    }

    return null
  },
}
