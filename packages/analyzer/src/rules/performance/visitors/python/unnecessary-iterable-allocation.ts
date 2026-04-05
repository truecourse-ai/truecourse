import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnecessaryIterableAllocationVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/unnecessary-iterable-allocation',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right || right.type !== 'call') return null

    const fn = right.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'list') return null

    const args = right.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // If the argument is a generator expression or another iterable call
    if (firstArg.type === 'generator_expression' || firstArg.type === 'call') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary list() allocation in for loop',
        'Wrapping a generator in list() before iterating creates an unnecessary intermediate list. Iterate the generator directly.',
        sourceCode,
        'Remove the list() wrapper and iterate the generator directly.',
      )
    }

    return null
  },
}
