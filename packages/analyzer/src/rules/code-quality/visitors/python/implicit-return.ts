import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function collectReturns(node: SyntaxNode, returns: SyntaxNode[]): void {
  if (node.type === 'return_statement') {
    returns.push(node)
    return
  }
  if (node.type === 'function_definition' && node !== node) return
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && child.type !== 'function_definition') collectReturns(child, returns)
  }
}

export const pythonImplicitReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/implicit-return',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    const returns: SyntaxNode[] = []
    collectReturns(bodyNode, returns)

    if (returns.length === 0) return null

    const withValue = returns.filter((r) => r.namedChildren.length > 0)
    const withoutValue = returns.filter((r) => r.namedChildren.length === 0)

    // Mixed returns: some with values, some without
    if (withValue.length > 0 && withoutValue.length > 0) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'function'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Inconsistent return statements',
        `Function \`${name}\` has mixed explicit and implicit returns — some paths return a value, others do not.`,
        sourceCode,
        'Make all return statements consistent: either all return a value or all use bare `return`.',
      )
    }
    return null
  },
}
