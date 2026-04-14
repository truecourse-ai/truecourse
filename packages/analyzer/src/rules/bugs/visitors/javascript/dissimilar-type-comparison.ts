import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const dissimilarTypeComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/dissimilar-type-comparison',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.text === '===' || c.text === '!==')

    if (!left || !right || !operator) return null

    // Check if left and right are different literal types (string vs number, string vs boolean, etc.)
    function getLiteralType(n: SyntaxNode): 'string' | 'number' | 'boolean' | 'null' | 'undefined' | null {
      if (n.type === 'string') return 'string'
      if (n.type === 'number') return 'number'
      if (n.type === 'true' || n.type === 'false') return 'boolean'
      if (n.type === 'null') return 'null'
      if (n.type === 'undefined') return 'undefined'
      return null
    }

    const leftType = getLiteralType(left)
    const rightType = getLiteralType(right)

    if (!leftType || !rightType) return null
    if (leftType === rightType) return null

    // Skip null === undefined — that's a common idiom
    if ((leftType === 'null' && rightType === 'undefined') || (leftType === 'undefined' && rightType === 'null')) return null

    const always = operator.text === '===' ? 'always false' : 'always true'
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Dissimilar type comparison',
      `\`${node.text}\` is ${always} — a ${leftType} and a ${rightType} are never strictly equal.`,
      sourceCode,
      'Use loose equality (== / !=) if type coercion is intended, or fix the comparison operands.',
    )
  },
}
