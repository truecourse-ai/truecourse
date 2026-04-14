import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSortedReversedRedundantVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/sorted-reversed-redundant',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Detect reversed(sorted(...))
    const fn = node.childForFieldName('function')
    if (!fn || fn.text !== 'reversed') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg || firstArg.type !== 'call') return null

    const innerFn = firstArg.childForFieldName('function')
    if (!innerFn || innerFn.text !== 'sorted') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant reversed(sorted(...))',
      '`reversed(sorted(...))` can be simplified to `sorted(..., reverse=True)`.',
      sourceCode,
      'Use `sorted(..., reverse=True)` instead of `reversed(sorted(...))`.',
    )
  },
}
