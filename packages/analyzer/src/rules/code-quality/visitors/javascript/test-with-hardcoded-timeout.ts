import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const testWithHardcodedTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-with-hardcoded-timeout',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    // Only flag in genuine test files. The previous check
    // (`filePath.includes('test')`) over-matched any path
    // containing the substring "test" (e.g., `tests/fixtures/...`,
    // `protested/...`).
    const isTestFile =
      /\.(?:test|spec|e2e)\.[jt]sx?$/i.test(filePath) ||
      /(?:[\\/]|^)(?:__tests__|__specs__)[\\/]/.test(filePath)
    if (!isTestFile) return null

    const fn = node.childForFieldName('function')
    if (!fn) return null
    const fnText = fn.type === 'identifier' ? fn.text : fn.childForFieldName('property')?.text ?? ''
    if (fnText !== 'setTimeout' && fnText !== 'sleep' && fnText !== 'delay') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Hardcoded timeout in test',
      `\`${fnText}()\` in tests is fragile and slow. Use proper async waiting (await, waitFor, polling) instead.`,
      sourceCode,
      'Replace with a deterministic async waiting mechanism.',
    )
  },
}
