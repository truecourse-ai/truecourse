import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryListInIterationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-list-in-iteration',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    // for x in list(iterable):
    const right = node.childForFieldName('right')
    if (!right || right.type !== 'call') return null

    const fn = right.childForFieldName('function')
    if (!fn || fn.text !== 'list') return null

    const args = right.childForFieldName('arguments')
    if (!args || args.namedChildCount === 0) return null

    return makeViolation(
      this.ruleKey, right, filePath, 'low',
      'Unnecessary list() in iteration',
      '`list()` wraps an iterable creating an unnecessary copy when only iteration is needed.',
      sourceCode,
      'Remove the `list()` wrapper — iterate the iterable directly.',
    )
  },
}
