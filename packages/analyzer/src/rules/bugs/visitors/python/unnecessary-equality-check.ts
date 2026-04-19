import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects equality checks between obviously incompatible literal types,
 * which will always be False (or True for !=).
 *
 * Heuristic-based: only catches comparisons between two different literal types.
 *
 * Examples:
 *   42 == "42"         # always False — int vs str
 *   True == "True"     # always False — bool vs str
 *   None == 0          # always False — None vs int
 */
export const pythonUnnecessaryEqualityCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unnecessary-equality-check',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    // comparison_operator has children: left, operator(s), right(s)
    // e.g., `42 == "42"` → [integer, "==", string]
    const children = node.namedChildren
    if (children.length < 2) return null

    // Simple two-operand comparison
    const operators = node.children.filter(
      (c) => !c.isNamed && (c.text === '==' || c.text === '!='),
    )
    if (operators.length !== 1) return null

    const left = children[0]
    const right = children[1]
    if (!left || !right) return null

    const leftKind = getLiteralKind(left)
    const rightKind = getLiteralKind(right)
    if (!leftKind || !rightKind) return null

    // Same type family — comparison is fine
    if (leftKind === rightKind) return null

    // bool is subtype of int in Python, so int == bool is valid
    if ((leftKind === 'int' && rightKind === 'bool') || (leftKind === 'bool' && rightKind === 'int')) return null

    const op = operators[0]!.text
    const result = op === '==' ? 'always False' : 'always True'

    return makeViolation(
      this.ruleKey,
      node,
      filePath,
      'high',
      'Unnecessary equality check',
      `Comparing \`${leftKind}\` with \`${rightKind}\` using \`${op}\` is ${result} — incompatible types.`,
      sourceCode,
      'Convert values to the same type before comparing, or remove the unnecessary check.',
    )
  },
}

type LiteralKind = 'int' | 'float' | 'str' | 'bool' | 'none' | 'list' | 'dict' | 'set'

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
    case 'set': return 'set'
    default: return null
  }
}
