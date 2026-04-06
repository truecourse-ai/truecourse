import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPytestFailWithoutMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pytest-fail-without-message',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 'pytest' || attr?.text !== 'fail') return null

    const args = node.childForFieldName('arguments')
    const hasArgs = args && args.namedChildren.length > 0

    if (!hasArgs) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'pytest.fail() without message',
        '`pytest.fail()` is called without a message. This provides no context for why the test failed.',
        sourceCode,
        'Add a descriptive message: `pytest.fail("reason the test failed")`.',
      )
    }

    return null
  },
}
