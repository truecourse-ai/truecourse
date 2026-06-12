import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_METHODLIKE_TYPES, getCSharpFunctionBody, getCSharpFunctionName, isCSharpFunctionBoundary } from './_helpers.js'

const MAX_RETURNS = 5

export const csharpTooManyReturnStatementsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-return-statements',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getCSharpFunctionBody(node)
    if (!bodyNode) return null

    let returnCount = 0

    function countReturns(n: SyntaxNode) {
      if (n.type === 'return_statement') {
        returnCount++
        return
      }
      // Returns inside lambdas / local functions belong to those functions.
      if (n.id !== bodyNode!.id && isCSharpFunctionBoundary(n.type)) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) countReturns(child)
      }
    }

    countReturns(bodyNode)

    if (returnCount > MAX_RETURNS) {
      const name = getCSharpFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many return statements',
        `Method \`${name}\` has ${returnCount} return statements (max ${MAX_RETURNS}). Consider refactoring to reduce complexity.`,
        sourceCode,
        'Refactor to reduce the number of return statements, e.g., using early returns, lookup tables, or extracting logic.',
      )
    }
    return null
  },
}
