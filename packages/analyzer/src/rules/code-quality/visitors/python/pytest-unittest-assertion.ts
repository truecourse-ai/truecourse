import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const UNITTEST_ASSERTIONS = new Set([
  'assertEqual', 'assertNotEqual', 'assertTrue', 'assertFalse',
  'assertIs', 'assertIsNot', 'assertIsNone', 'assertIsNotNone',
  'assertIn', 'assertNotIn', 'assertIsInstance', 'assertNotIsInstance',
  'assertRaises', 'assertRaisesRegex', 'assertWarns', 'assertWarnsRegex',
  'assertAlmostEqual', 'assertNotAlmostEqual', 'assertGreater', 'assertGreaterEqual',
  'assertLess', 'assertLessEqual', 'assertRegex', 'assertNotRegex',
  'assertCountEqual', 'assertMultiLineEqual', 'assertSequenceEqual',
  'assertListEqual', 'assertTupleEqual', 'assertSetEqual', 'assertDictEqual',
])

export const pythonPytestUnittestAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pytest-unittest-assertion',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 'self' || !attr) return null

    if (UNITTEST_ASSERTIONS.has(attr.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unittest assertion in pytest',
        `\`self.${attr.text}()\` is a unittest-style assertion. In pytest tests, use plain \`assert\` statements instead — they provide better failure messages through pytest\'s assertion rewriting.`,
        sourceCode,
        `Replace \`self.${attr.text}(a, b)\` with a plain \`assert\` statement like \`assert a == b\`.`,
      )
    }

    return null
  },
}
