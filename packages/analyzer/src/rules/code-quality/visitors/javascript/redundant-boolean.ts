import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const redundantBooleanVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-boolean',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const elseClause = node.children.find((c) => c.type === 'else_clause')
    if (!consequence || !elseClause) return null

    function getReturnValue(block: SyntaxNode): string | null {
      let target = block
      if (target.type === 'statement_block') {
        const stmts = target.namedChildren
        if (stmts.length !== 1 || stmts[0].type !== 'return_statement') return null
        target = stmts[0]
      }
      if (target.type !== 'return_statement') return null
      const value = target.namedChildren[0]
      if (!value) return null
      return value.text
    }

    const trueVal = getReturnValue(consequence)
    const elseBody = elseClause.namedChildren[0]
    if (!elseBody) return null
    const falseVal = getReturnValue(elseBody)

    if ((trueVal === 'true' && falseVal === 'false') || (trueVal === 'false' && falseVal === 'true')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant boolean return',
        'if/else returning true/false can be simplified to `return <condition>` or `return !<condition>`.',
        sourceCode,
        'Replace with `return <condition>` or `return !<condition>`.',
      )
    }
    return null
  },
}
