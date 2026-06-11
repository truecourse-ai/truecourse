import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

/** Boolean assertion methods across xUnit / NUnit / MSTest. */
const BOOLEAN_ASSERTS = new Set(['True', 'IsTrue', 'False', 'IsFalse', 'That'])

/**
 * `Assert.True(true)` and friends — the assertion tests a compile-time
 * constant, so it can never catch a regression.
 */
export const csharpUnconditionalAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unconditional-assertion',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpReceiver(node).split('.').pop() !== 'Assert') return null
    const method = getCSharpMethodName(node)
    if (!BOOLEAN_ASSERTS.has(method)) return null

    const args = getCSharpArguments(node)
    if (args.length === 0) return null
    if (args[0]!.type !== 'boolean_literal') return null

    const value = args[0]!.text
    const alwaysPasses = (value === 'true') === (method === 'True' || method === 'IsTrue' || method === 'That')
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unconditional assertion',
      `\`Assert.${method}(${value})\` always ${alwaysPasses ? 'passes' : 'fails'} — it asserts a constant, not behavior.`,
      sourceCode,
      'Assert a runtime condition derived from the code under test, or remove the assertion.',
    )
  },
}
