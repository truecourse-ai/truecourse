import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const SKIPPABLE_TEST_ATTRS = new Set(['Fact', 'Theory', 'TestMethod', 'Test'])

export const csharpTestSkippedVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-skipped',
  languages: ['csharp'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')?.text.split('.').pop() ?? ''

    // NUnit / MSTest: [Ignore("...")].
    if (name === 'Ignore') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Skipped test: [Ignore]',
        '`[Ignore]` is committed — skipped tests are not run and may hide broken functionality.',
        sourceCode,
        'Fix the test and remove `[Ignore]`, or document why it is skipped.',
      )
    }

    // xUnit: [Fact(Skip = "...")] / [Theory(Skip = "...")].
    if (SKIPPABLE_TEST_ATTRS.has(name)) {
      const args = node.namedChildren.find((c) => c?.type === 'attribute_argument_list')
      const skipArg = args?.namedChildren.find(
        (a) => a?.type === 'attribute_argument' && a.childForFieldName('name')?.text === 'Skip',
      )
      if (skipArg) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          `Skipped test: [${name}(Skip = ...)]`,
          'A skipped test is committed — skipped tests are not run and may hide broken functionality.',
          sourceCode,
          'Fix the test and remove the `Skip` argument, or document why it is skipped.',
        )
      }
    }

    return null
  },
}
