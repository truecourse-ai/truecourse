import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function alwaysExits(block: SyntaxNode): boolean {
  const stmts = block.namedChildren
  if (stmts.length === 0) return false

  const last = stmts[stmts.length - 1]
  return (
    last.type === 'return_statement' ||
    last.type === 'raise_statement' ||
    last.type === 'break_statement' ||
    last.type === 'continue_statement'
  )
}

export const pythonNeedlessElseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/needless-else',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Find the else_clause (not elif)
    const elseClause = node.children.find((c) => c.type === 'else_clause')
    if (!elseClause) return null

    // The if body must always exit
    const ifBody = node.childForFieldName('consequence')
    if (!ifBody) return null

    if (!alwaysExits(ifBody)) return null

    return makeViolation(
      this.ruleKey, elseClause, filePath, 'low',
      'Needless else clause',
      'The `else` clause is unnecessary because the `if` branch always returns/breaks/continues/raises.',
      sourceCode,
      'Remove the `else` and un-indent its body.',
    )
  },
}
