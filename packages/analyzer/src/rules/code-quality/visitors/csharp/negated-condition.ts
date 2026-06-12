import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function statementCount(body: SyntaxNode | null): number {
  if (!body) return 0
  if (body.type === 'block') {
    return body.namedChildren.filter((c) => c && c.type !== 'comment').length
  }
  return 1
}

export const csharpNegatedConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/negated-condition',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    const alternative = node.childForFieldName('alternative')
    if (!condition || !alternative) return null
    // An else-if chain orders its branches deliberately.
    if (alternative.type === 'if_statement') return null

    let inner = condition
    while (inner.type === 'parenthesized_expression' && inner.namedChildren[0]) {
      inner = inner.namedChildren[0]!
    }
    if (inner.type !== 'prefix_unary_expression' || inner.children[0]?.type !== '!') return null

    // Inverting only helps when it moves a short bail branch out of the way
    // of a substantially larger happy path.
    const ifCount = statementCount(node.childForFieldName('consequence'))
    const elseCount = statementCount(alternative)
    if (elseCount < ifCount + 2) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Negated condition with else',
      'Condition is negated but has an else block. Invert the condition and swap the branches for better readability.',
      sourceCode,
      'Invert the condition and swap the if/else bodies.',
    )
  },
}
