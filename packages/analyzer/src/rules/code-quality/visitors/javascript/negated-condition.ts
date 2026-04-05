import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const negatedConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/negated-condition',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    const elsePart = node.children.find((c) => c.type === 'else_clause')
    if (!condition || !elsePart) return null

    const inner = condition.type === 'parenthesized_expression' ? condition.namedChildren[0] : condition
    if (!inner || inner.type !== 'unary_expression') return null
    const op = inner.childForFieldName('operator') ?? inner.children[0]
    if (!op || op.text !== '!') return null

    const elseBody = elsePart.namedChildren[0]
    if (elseBody?.type === 'if_statement') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Negated condition with else',
      'Condition is negated but has an else block. Invert the condition and swap the branches for better readability.',
      sourceCode,
      'Invert the condition and swap the if/else bodies.',
    )
  },
}
