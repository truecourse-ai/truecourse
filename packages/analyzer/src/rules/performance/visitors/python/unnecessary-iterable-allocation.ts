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

    // When list() is called with a generator expression, tree-sitter parses the
    // arguments field as a generator_expression (not argument_list containing one).
    if (args.type === 'generator_expression') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary list() allocation in for loop',
        'Wrapping a generator in list() before iterating creates an unnecessary intermediate list. Iterate the generator directly.',
        sourceCode,
        'Remove the list() wrapper and iterate the generator directly.',
      )
    }

    // Handle list(range(...)) or list(some_iterable_call())
    if (args.type === 'argument_list') {
      const firstArg = args.namedChildren[0]
      if (firstArg && (firstArg.type === 'generator_expression' || firstArg.type === 'call')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary list() allocation in for loop',
          'Wrapping an iterable in list() before iterating creates an unnecessary intermediate list. Iterate the iterable directly.',
          sourceCode,
          'Remove the list() wrapper and iterate the iterable directly.',
        )
      }
    }

    return null
  },
}
