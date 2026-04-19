import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const equalsInForTerminationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/equals-in-for-termination',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    function hasEqualityOp(n: SyntaxNode): boolean {
      const op = n.children.find((c) => c.type === '==' || c.type === '===')
      return !!op
    }

    if (hasEqualityOp(condition)) {
      return makeViolation(
        this.ruleKey, condition, filePath, 'low',
        'Equality in for loop termination',
        'Using `==` or `===` in a `for` loop termination condition may cause an infinite loop if the loop variable skips the exact value.',
        sourceCode,
        'Use `<`, `<=`, `>`, or `>=` instead of `==`/`===` for safer loop termination.',
      )
    }
    return null
  },
}
