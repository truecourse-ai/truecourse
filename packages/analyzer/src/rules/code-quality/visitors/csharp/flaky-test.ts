import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpEnclosingTestMethod } from './_helpers.js'

const TIME_SOURCES = new Set([
  'DateTime.Now', 'DateTime.UtcNow', 'DateTime.Today',
  'DateTimeOffset.Now', 'DateTimeOffset.UtcNow',
  'Environment.TickCount', 'Stopwatch.GetTimestamp',
])

const ASSERT_RECEIVERS = new Set(['Assert', 'CollectionAssert', 'StringAssert'])

/**
 * True when `node` sits inside the argument list of an assertion call —
 * `Assert.*(...)` or a FluentAssertions `.Should()...` chain.
 */
function isInsideAssertionArgument(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'argument_list') {
      const call = current.parent
      if (call?.type === 'invocation_expression') {
        const fn = call.childForFieldName('function')
        if (fn?.type === 'member_access_expression') {
          const receiver = fn.childForFieldName('expression')
          if (receiver?.type === 'identifier' && ASSERT_RECEIVERS.has(receiver.text)) return true
          if (fn.text.includes('.Should()') || /\.Should\(\)/.test(receiver?.text ?? '')) return true
        }
      }
    }
    if (current.type === 'method_declaration') return false
    current = current.parent
  }
  return false
}

/**
 * Time sources are only flagged inside assertion arguments — building test
 * DATA with DateTime.UtcNow is idiomatic and harmless; asserting against the
 * wall clock is the flake. Seedless `new Random()` (time-seeded) is flagged
 * anywhere in a test.
 */
export const csharpFlakyTestVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/flaky-test',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    if (!getCSharpEnclosingTestMethod(node)) return null

    if (node.type === 'member_access_expression') {
      const text = node.text
      if (TIME_SOURCES.has(text) && isInsideAssertionArgument(node)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Non-deterministic test',
          `Asserting against \`${text}\` makes the test timing-dependent and flaky.`,
          sourceCode,
          'Inject a fake time source (TimeProvider / ISystemClock) or compare with a tolerance.',
        )
      }
      if (text === 'Random.Shared') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Non-deterministic test',
          'Using `Random.Shared` in a test — random values make test results unpredictable.',
          sourceCode,
          'Use a seeded `new Random(42)` or fixed test data.',
        )
      }
      return null
    }

    // `new Random()` without a seed is seeded from the timer.
    if (node.type === 'object_creation_expression') {
      const typeName = node.childForFieldName('type')?.text
      if (typeName !== 'Random') return null
      const args = node.childForFieldName('arguments')
      if (args && args.namedChildCount > 0) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Non-deterministic test',
        'Seedless `new Random()` in a test — each run produces different values, making failures unreproducible.',
        sourceCode,
        'Seed the generator (`new Random(42)`) or use fixed test data.',
      )
    }

    return null
  },
}
