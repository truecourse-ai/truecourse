import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function hasBreak(node: SyntaxNode): boolean {
  if (node.type === 'break_statement') return true
  // Don't descend into nested loops
  if (node.type === 'for_statement' || node.type === 'while_statement') return false
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && hasBreak(child)) return true
  }
  return false
}

export const pythonUselessElseOnLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-else-on-loop',
  languages: ['python'],
  nodeTypes: ['for_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    // Check for else clause
    const elseClause = node.namedChildren.find((c) => c.type === 'else_clause')
    if (!elseClause) return null

    // Check if the loop body contains a break
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    if (hasBreak(bodyNode)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Useless else on loop',
      'Loop `else` clause is useless because the loop has no `break` — the `else` always executes.',
      sourceCode,
      'Remove the `else` clause or add a `break` in the loop body to make the else meaningful.',
    )
  },
}
