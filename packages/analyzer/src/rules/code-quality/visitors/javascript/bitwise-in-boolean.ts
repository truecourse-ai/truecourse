import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

export const bitwiseInBooleanVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/bitwise-in-boolean',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '&' || c.type === '|')
    if (!op) return null

    const BOOL_CONTEXT_TYPES = new Set(['if_statement', 'while_statement', 'for_statement', 'do_statement', 'ternary_expression'])
    let current: SyntaxNode | null = node
    let parent: SyntaxNode | null = node.parent

    while (parent?.type === 'parenthesized_expression') {
      current = parent
      parent = parent.parent
    }

    if (!parent) return null

    const isBoolContext = BOOL_CONTEXT_TYPES.has(parent.type)
      && parent.childForFieldName('condition')?.id === current.id

    if (!isBoolContext) return null

    const intended = op.type === '&' ? '&&' : '||'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Bitwise operator in boolean context',
      `Bitwise \`${op.type}\` used in a boolean context — did you mean logical \`${intended}\`?`,
      sourceCode,
      `Replace \`${op.type}\` with \`${intended}\` if a logical operator was intended.`,
    )
  },
}
