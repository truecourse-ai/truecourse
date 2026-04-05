import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonIterationOverSetVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/iteration-over-set',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right) return null

    if (right.type === 'set') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Iteration over set literal',
        'Iterating over a set literal `{1, 2, 3}` produces results in non-deterministic order, which may cause flaky tests or inconsistent behavior.',
        sourceCode,
        'Wrap in `sorted()` to get a deterministic order, or use a list/tuple literal if order matters.',
      )
    }

    return null
  },
}
