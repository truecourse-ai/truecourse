import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

// Assertions where a more specific form exists
const GENERIC_ASSERTIONS_MAP: Record<string, string> = {
  'assertTrue': 'Use assertEqual(a, b) for equality, assertIs(a, b) for identity, etc.',
  'assertFalse': 'Use assertNotEqual or a specific assertion instead of assertFalse(condition)',
}

function hasComparisonArg(args: SyntaxNode): boolean {
  const firstArg = args.namedChildren[0]
  if (!firstArg) return false
  return firstArg.type === 'comparison_operator' || firstArg.type === 'boolean_operator'
}

export const pythonUnittestSpecificAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unittest-specific-assertion',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 'self' || !attr) return null

    const methodName = attr.text
    if (!(methodName in GENERIC_ASSERTIONS_MAP)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    if (hasComparisonArg(args)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Use specific unittest assertion',
        `\`self.${methodName}(a ${
          methodName === 'assertTrue' ? '==' : '!='
        } b)\` should use \`self.assertEqual(a, b)\` which gives more informative failure messages.`,
        sourceCode,
        GENERIC_ASSERTIONS_MAP[methodName],
      )
    }

    return null
  },
}
