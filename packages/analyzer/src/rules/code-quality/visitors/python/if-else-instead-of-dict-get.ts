import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const pythonIfElseInsteadOfDictGetVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/if-else-instead-of-dict-get',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Pattern: if key in dict: val = dict[key] else: val = default
    const condition = node.childForFieldName('condition')
    if (!condition || condition.type !== 'comparison_operator') return null

    // Check: key in dict
    const inOp = condition.children.find((c) => c.type === 'in')
    if (!inOp) return null
    const operands = condition.namedChildren
    if (operands.length < 2) return null
    const keyNode = operands[0]
    const dictNode = operands[operands.length - 1]

    const alternative = node.namedChildren.find((c) => c.type === 'else_clause')
    if (!alternative) return null

    const hasElif = node.namedChildren.some((c) => c.type === 'elif_clause')
    if (hasElif) return null

    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null
    const elseBody = alternative.namedChildren.find((c) => c.type === 'block')
    if (!elseBody) return null

    // Check if-body assigns: var = dict[key]
    function getSingleAssign(body: SyntaxNode): { target: string; value: string } | null {
      const stmts = body.namedChildren
      if (stmts.length !== 1) return null
      // tree-sitter wraps assignments in expression_statement
      let assignNode = stmts[0]
      if (assignNode.type === 'expression_statement') {
        const inner = assignNode.namedChildren[0]
        if (inner?.type === 'assignment') assignNode = inner
        else return null
      }
      if (assignNode.type !== 'assignment') return null
      const left = assignNode.childForFieldName('left')
      const right = assignNode.childForFieldName('right')
      return left && right ? { target: left.text, value: right.text } : null
    }

    const thenAssign = getSingleAssign(consequence)
    const elseAssign = getSingleAssign(elseBody)

    if (!thenAssign || !elseAssign) return null
    if (thenAssign.target !== elseAssign.target) return null

    // then branch should be: var = dict[key]
    const expectedAccess = `${dictNode.text}[${keyNode.text}]`
    if (thenAssign.value !== expectedAccess) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'if-else instead of dict.get()',
      `Can be simplified to: \`${thenAssign.target} = ${dictNode.text}.get(${keyNode.text}, ${elseAssign.value})\`.`,
      sourceCode,
      `Replace with \`${thenAssign.target} = ${dictNode.text}.get(${keyNode.text}, ${elseAssign.value})\`.`,
    )
  },
}
