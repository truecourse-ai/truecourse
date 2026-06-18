import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_TEST_METHOD_ATTRIBUTES, parseCSharpNumber } from './_helpers.js'

const HUGE_TIMEOUT_MS = 60000

function flagTimeoutValue(valueNode: SyntaxNode | null | undefined): number | null {
  if (valueNode?.type !== 'integer_literal') return null
  const timeout = parseCSharpNumber(valueNode.text)
  if (timeout === null) return null
  return timeout === 0 || timeout >= HUGE_TIMEOUT_MS ? timeout : null
}

export const csharpDisabledTestTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/disabled-test-timeout',
  languages: ['csharp'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')?.text.split('.').pop() ?? ''
    const args = node.namedChildren.find((c) => c?.type === 'attribute_argument_list')

    let timeout: number | null = null
    if (name === 'Timeout') {
      // NUnit / MSTest: [Timeout(600000)].
      timeout = flagTimeoutValue(args?.namedChildren[0]?.namedChildren[0])
    } else if (CSHARP_TEST_METHOD_ATTRIBUTES.has(name)) {
      // xUnit: [Fact(Timeout = 600000)].
      const timeoutArg = args?.namedChildren.find(
        (a) => a?.type === 'attribute_argument' && a.childForFieldName('name')?.text === 'Timeout',
      )
      timeout = flagTimeoutValue(timeoutArg?.namedChildren.find((c) => c?.type === 'integer_literal'))
    }
    if (timeout === null) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Disabled or excessive test timeout',
      `Test timeout of \`${timeout}ms\` is ${timeout === 0 ? 'disabled' : 'very large'}. This may hide slow tests or indicate a flaky test.`,
      sourceCode,
      'Remove the timeout or use a reasonable value (e.g. 5000ms).',
    )
  },
}
