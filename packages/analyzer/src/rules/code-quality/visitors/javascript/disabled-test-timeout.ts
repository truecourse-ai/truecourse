import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const disabledTestTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/disabled-test-timeout',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    // Only flag in test files
    if (!filePath.includes('test') && !filePath.includes('spec') && !filePath.includes('.test.') && !filePath.includes('.spec.')) return null

    const fn = node.childForFieldName('function')
    if (!fn) return null

    // vitest/jest: it('name', fn, timeout) or test('name', fn, timeout) — look for huge/zero timeout
    const fnName = fn.type === 'identifier' ? fn.text : fn.childForFieldName('property')?.text ?? ''
    if (fnName !== 'it' && fnName !== 'test' && fnName !== 'describe') return null

    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildCount < 3) return null

    const thirdArg = args.namedChild(2)
    if (!thirdArg || thirdArg.type !== 'number') return null

    const timeout = parseInt(thirdArg.text, 10)
    if (timeout === 0 || timeout >= 60000) {
      return makeViolation(
        this.ruleKey, thirdArg, filePath, 'low',
        'Disabled or excessive test timeout',
        `Test timeout of \`${timeout}ms\` is ${timeout === 0 ? 'disabled' : 'very large'}. This may hide slow tests or indicate a flaky test.`,
        sourceCode,
        'Remove the timeout or use a reasonable value (e.g., 5000ms).',
      )
    }
    return null
  },
}
