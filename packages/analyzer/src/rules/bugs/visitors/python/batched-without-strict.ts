import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonBatchedWithoutStrictVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/batched-without-strict',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    const funcText = func.text
    if (funcText !== 'itertools.batched' && funcText !== 'batched') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

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
        'itertools.batched without strict parameter',
        '`itertools.batched()` called without `strict=True` — an incomplete last batch will be silently returned without raising an error.',
        sourceCode,
        'Add `strict=True` to `itertools.batched()` to raise a `ValueError` when the iterable is not evenly divisible.',
      )
    }

    return null
  },
}
