import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { CSHARP_LITERAL_TYPES } from './_helpers.js'

/**
 * xUnit, NUnit, and MSTest all put EXPECTED first: Assert.Equal(expected,
 * actual) / Assert.AreEqual(expected, actual). A literal in the second
 * (actual) slot with a computed first argument means the arguments are
 * swapped — the assertion still passes, but failure messages lie.
 * (Mirrors xUnit analyzer xUnit2000.)
 */
const INVERTIBLE_ASSERTS = new Set([
  'Equal', 'NotEqual', 'StrictEqual', 'Same', 'NotSame',
  'AreEqual', 'AreNotEqual', 'AreSame', 'AreNotSame',
])

function isLiteral(node: SyntaxNode): boolean {
  if (CSHARP_LITERAL_TYPES.has(node.type)) return true
  if (node.type === 'prefix_unary_expression' && node.text.startsWith('-')) {
    const operand = node.namedChildren[0]
    return operand?.type === 'integer_literal' || operand?.type === 'real_literal'
  }
  return false
}

export const csharpTestInvertedArgumentsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-inverted-arguments',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpReceiver(node) !== 'Assert') return null
    const method = getCSharpMethodName(node)
    if (!INVERTIBLE_ASSERTS.has(method)) return null

    const args = getCSharpArguments(node)
    if (args.length < 2) return null
    const [expected, actual] = args
    if (!expected || !actual) return null

    if (!isLiteral(expected) && isLiteral(actual)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Inverted assertion arguments',
        `\`Assert.${method}(expected, actual)\` has the literal in the actual position — the arguments look swapped, which produces misleading failure messages.`,
        sourceCode,
        `Swap the arguments: \`Assert.${method}(${actual.text}, ${expected.text})\`.`,
      )
    }

    return null
  },
}
