import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects `is` / `is not` checks between literals of dissimilar types
 * that can never be the same object.
 *
 * Examples:
 *   42 is "42"       # always False
 *   True is "True"   # always False
 *   [] is ()         # always False
 */
export const pythonIdentityWithDissimilarTypesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/identity-with-dissimilar-types',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren
    if (children.length < 2) return null

    // Look for `is` or `is not` operators
    const hasIdentityOp = node.children.some(
      (c) => !c.isNamed && (c.text === 'is' || c.text === 'not'),
    )
    if (!hasIdentityOp) return null

    // Reconstruct operator — could be "is" or "is not"
    const opParts: string[] = []
    let foundIs = false
    for (const c of node.children) {
      if (!c.isNamed) {
        if (c.text === 'is') { foundIs = true; opParts.push('is') }
        if (c.text === 'not' && foundIs) { opParts.push('not') }
      }
    }
    if (!foundIs) return null
    const op = opParts.join(' ')

    const left = children[0]
    const right = children[1]
    if (!left || !right) return null

    const leftKind = getLiteralKind(left)
    const rightKind = getLiteralKind(right)
    if (!leftKind || !rightKind) return null

    // Same type — identity check may make sense for small ints/strings
    if (leftKind === rightKind) return null

    // bool is subtype of int — identity can work for small values
    if ((leftKind === 'int' && rightKind === 'bool') || (leftKind === 'bool' && rightKind === 'int')) return null

    const result = op === 'is' ? 'always False' : 'always True'

    return makeViolation(
      this.ruleKey,
      node,
      filePath,
      'high',
      'Identity check with dissimilar types',
      `Using \`${op}\` between \`${leftKind}\` and \`${rightKind}\` is ${result} — these types can never be the same object.`,
      sourceCode,
      'Use `==` / `!=` for equality comparison, or fix the types.',
    )
  },
}

type LiteralKind = 'int' | 'float' | 'str' | 'bool' | 'none' | 'list' | 'dict' | 'set' | 'tuple'

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
    case 'tuple': return 'tuple'
    default: return null
  }
}
