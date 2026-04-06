import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAssertFalseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assert-false',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.namedChildren[0]
    if (!condition) return null

    if (condition.type === 'false' || condition.text === 'False') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'assert False instead of raise',
        '`assert False` is removed when Python is run with the `-O` optimization flag — use `raise AssertionError(...)` or another exception instead.',
        sourceCode,
        'Replace `assert False, message` with `raise AssertionError(message)` or an appropriate exception.',
      )
    }
    return null
  },
}
