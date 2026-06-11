import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

const EQUALITY_ASSERTS = new Set([
  'Equal', 'NotEqual', 'StrictEqual', 'NotStrictEqual', 'Same', 'NotSame', 'Equivalent', // xUnit
  'AreEqual', 'AreNotEqual', 'AreSame', 'AreNotSame', 'AreEquivalent', // NUnit / MSTest
])

const ASSERT_RECEIVERS = new Set(['Assert', 'CollectionAssert', 'StringAssert'])

// Argument shapes that can meaningfully differ between "expected" and
// "actual" — literals are excluded (e.g. table-driven sanity rows).
const COMPARABLE_TYPES = new Set([
  'identifier', 'member_access_expression', 'invocation_expression',
  'element_access_expression', 'conditional_access_expression',
])

export const csharpTestSameArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-same-argument',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (!ASSERT_RECEIVERS.has(getCSharpReceiver(node))) return null
    const method = getCSharpMethodName(node)
    if (!EQUALITY_ASSERTS.has(method)) return null

    const args = getCSharpArguments(node)
    if (args.length < 2) return null
    const [first, second] = args
    if (!first || !second) return null

    if (!COMPARABLE_TYPES.has(first.type)) return null
    if (first.text === second.text && first.text.length > 1) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Same argument in assertion',
        `Both arguments of \`${method}()\` are \`${first.text}\` — the assertion always passes regardless of actual behavior.`,
        sourceCode,
        'Use different values for the expected and actual arguments.',
      )
    }

    return null
  },
}
