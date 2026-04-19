import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function getSingleAssignment(body: SyntaxNode): { varName: string; value: string } | null {
  const stmts = body.namedChildren
  if (stmts.length !== 1) return null
  // tree-sitter wraps assignments in expression_statement
  let stmt = stmts[0]
  if (stmt.type === 'expression_statement') {
    const inner = stmt.namedChildren[0]
    if (inner?.type === 'assignment') stmt = inner
    else return null
  }
  if (stmt.type !== 'assignment') return null
  const left = stmt.childForFieldName('left')
  const right = stmt.childForFieldName('right')
  if (!left || !right) return null
  return { varName: left.text, value: right.text }
}

export const pythonIfElseInsteadOfTernaryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/if-else-instead-of-ternary',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const alternative = node.namedChildren.find((c) => c.type === 'else_clause')
    if (!alternative) return null

    // No elif
    const hasElif = node.namedChildren.some((c) => c.type === 'elif_clause')
    if (hasElif) return null

    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null
    const elseBody = alternative.namedChildren.find((c) => c.type === 'block')
    if (!elseBody) return null

    const thenAssign = getSingleAssignment(consequence)
    const elseAssign = getSingleAssignment(elseBody)

    if (!thenAssign || !elseAssign) return null
    if (thenAssign.varName !== elseAssign.varName) return null

    const condition = node.childForFieldName('condition')
    const condText = condition?.text || 'condition'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'if-else block instead of ternary',
      `This if-else can be simplified to: \`${thenAssign.varName} = ${thenAssign.value} if ${condText} else ${elseAssign.value}\`.`,
      sourceCode,
      `Replace with a ternary expression: \`${thenAssign.varName} = ${thenAssign.value} if ${condText} else ${elseAssign.value}\`.`,
    )
  },
}
