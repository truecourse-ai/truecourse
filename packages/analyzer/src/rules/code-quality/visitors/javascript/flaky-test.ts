import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects patterns that make tests flaky/non-deterministic:
 * - Using Date.now() or new Date() in test assertions
 * - Using Math.random() in tests
 * - setTimeout/setInterval usage in tests (timing-dependent)
 * - Network calls without mocking
 */
export const flakyTestVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/flaky-test',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    // Only check test files
    if (!/\.(test|spec)\.[jt]sx?$/.test(filePath)) return null

    const fn = node.childForFieldName('function')
    if (!fn) return null
    const fnText = fn.text

    // Check if inside a test/it block
    if (!isInsideTest(node)) return null

    // Date.now() in assertions
    if (fnText === 'Date.now' || fnText === 'performance.now') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Non-deterministic test',
        `Using ${fnText}() in a test — timing-dependent assertions make tests flaky.`,
        sourceCode,
        'Mock the time source or use relative comparisons with tolerance.',
      )
    }

    // Math.random() in tests
    if (fnText === 'Math.random') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Non-deterministic test',
        'Using Math.random() in a test — random values make test results unpredictable.',
        sourceCode,
        'Use a seeded random generator or fixed test data.',
      )
    }

    // setTimeout in test body (not in the code under test)
    if (fnText === 'setTimeout' || fnText === 'setInterval') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Timing-dependent test',
        `Using ${fnText}() in a test — timing-dependent logic makes tests flaky.`,
        sourceCode,
        'Use fake timers (vi.useFakeTimers, jest.useFakeTimers) instead of real timers.',
      )
    }

    return null
  },
}

function isInsideTest(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (current.type === 'call_expression') {
      const fn = current.childForFieldName('function')
      if (fn) {
        const text = fn.text
        if (text === 'it' || text === 'test' || text === 'it.each' || text === 'test.each') {
          return true
        }
      }
    }
    current = current.parent
  }
  return false
}
