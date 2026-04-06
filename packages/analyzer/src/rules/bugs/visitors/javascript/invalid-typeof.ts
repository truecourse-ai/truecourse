import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, VALID_TYPEOF_VALUES } from './_helpers.js'

export const invalidTypeofVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-typeof',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => ['===', '==', '!==', '!='].includes(c.text))

    if (!left || !right || !operator) return null

    let typeofSide: SyntaxNode | null = null
    let stringSide: SyntaxNode | null = null

    function isTypeofExpr(n: SyntaxNode): boolean {
      return n.type === 'unary_expression' && n.children.some((c) => c.type === 'typeof')
    }

    if (isTypeofExpr(left) && right.type === 'string') {
      typeofSide = left
      stringSide = right
    } else if (isTypeofExpr(right) && left.type === 'string') {
      typeofSide = right
      stringSide = left
    }

    if (!typeofSide || !stringSide) return null

    // Extract the string content (strip quotes)
    const raw = stringSide.text
    const value = raw.slice(1, -1)

    if (!VALID_TYPEOF_VALUES.has(value)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Invalid typeof comparison',
        `typeof is compared to \`${raw}\` which is not a valid typeof result. Valid values are: ${[...VALID_TYPEOF_VALUES].join(', ')}.`,
        sourceCode,
        `Fix the string to one of: ${[...VALID_TYPEOF_VALUES].join(', ')}.`,
      )
    }
    return null
  },
}
