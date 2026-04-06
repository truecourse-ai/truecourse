import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects test assertions that compare literals of incompatible types,
 * meaning they always fail or always pass.
 *
 * Examples:
 *   assert 42 == "42"              # always False
 *   self.assertEqual(42, "42")     # always fails
 *   assert 1 != "1"               # always True (useless test)
 */
export const pythonAssertionIncompatibleTypesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assertion-incompatible-types',
  languages: ['python'],
  nodeTypes: ['assert_statement', 'call'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'assert_statement') {
      return checkAssertStatement(node, filePath, sourceCode, this.ruleKey)
    }
    if (node.type === 'call') {
      return checkAssertCall(node, filePath, sourceCode, this.ruleKey)
    }
    return null
  },
}

function checkAssertStatement(
  node: SyntaxNode, filePath: string, sourceCode: string, ruleKey: string,
): import('@truecourse/shared').CodeViolation | null {
  // `assert expr` — look for comparison in expr
  const expr = node.namedChildren[0]
  if (!expr || expr.type !== 'comparison_operator') return null

  return checkComparison(expr, node, filePath, sourceCode, ruleKey)
}

function checkAssertCall(
  node: SyntaxNode, filePath: string, sourceCode: string, ruleKey: string,
): import('@truecourse/shared').CodeViolation | null {
  const func = node.childForFieldName('function')
  if (!func) return null

  // Match self.assertEqual, self.assertNotEqual, etc.
  const funcText = func.text
  const isEqualAssert = /(?:assertEqual|assertEquals|assert_equal)$/.test(funcText)
  const isNotEqualAssert = /(?:assertNotEqual|assertNotEquals|assert_not_equal)$/.test(funcText)

  if (!isEqualAssert && !isNotEqualAssert) return null

  const args = node.childForFieldName('arguments')
  if (!args) return null

  const positionalArgs = args.namedChildren.filter((c) => c.type !== 'keyword_argument')
  if (positionalArgs.length < 2) return null

  const leftKind = getLiteralKind(positionalArgs[0]!)
  const rightKind = getLiteralKind(positionalArgs[1]!)
  if (!leftKind || !rightKind) return null
  if (leftKind === rightKind) return null
  if (areBoolIntCompatible(leftKind, rightKind)) return null

  const result = isEqualAssert ? 'always fail' : 'always pass (useless)'

  return makeViolation(
    ruleKey,
    node,
    filePath,
    'high',
    'Assertion compares incompatible types',
    `\`${funcText}\` comparing \`${leftKind}\` with \`${rightKind}\` will ${result}.`,
    sourceCode,
    'Compare values of the same type or convert them first.',
  )
}

function checkComparison(
  compNode: SyntaxNode, reportNode: SyntaxNode,
  filePath: string, sourceCode: string, ruleKey: string,
): import('@truecourse/shared').CodeViolation | null {
  const children = compNode.namedChildren
  if (children.length < 2) return null

  const ops = compNode.children.filter((c) => !c.isNamed && (c.text === '==' || c.text === '!='))
  if (ops.length !== 1) return null

  const leftKind = getLiteralKind(children[0]!)
  const rightKind = getLiteralKind(children[1]!)
  if (!leftKind || !rightKind) return null
  if (leftKind === rightKind) return null
  if (areBoolIntCompatible(leftKind, rightKind)) return null

  const op = ops[0]!.text
  const result = op === '==' ? 'always False' : 'always True'

  return makeViolation(
    ruleKey,
    reportNode,
    filePath,
    'high',
    'Assertion compares incompatible types',
    `Assertion comparing \`${leftKind}\` with \`${rightKind}\` is ${result}.`,
    sourceCode,
    'Compare values of the same type or convert them first.',
  )
}

type LiteralKind = 'int' | 'float' | 'str' | 'bool' | 'none' | 'list' | 'dict'

function getLiteralKind(node: SyntaxNode): LiteralKind | null {
  switch (node.type) {
    case 'integer': return 'int'
    case 'float': return 'float'
    case 'string':
    case 'concatenated_string': return 'str'
    case 'true':
    case 'false': return 'bool'
    case 'none': return 'none'
    case 'list': return 'list'
    case 'dictionary': return 'dict'
    default: return null
  }
}

function areBoolIntCompatible(a: LiteralKind, b: LiteralKind): boolean {
  return (a === 'int' && b === 'bool') || (a === 'bool' && b === 'int')
}
