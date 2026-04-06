import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPytestWarnsIssuesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pytest-warns-issues',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 'pytest' || attr?.text !== 'warns') return null

    const args = node.childForFieldName('arguments')
    const positionalArgs = args ? args.namedChildren.filter(
      (c) => c.type !== 'keyword_argument',
    ) : []

    if (positionalArgs.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'pytest.warns() without warning class',
        '`pytest.warns()` is called without a warning class — it will match any warning, making the test non-specific.',
        sourceCode,
        'Specify the expected warning class: `pytest.warns(UserWarning)`.',
      )
    }

    return null
  },
}
