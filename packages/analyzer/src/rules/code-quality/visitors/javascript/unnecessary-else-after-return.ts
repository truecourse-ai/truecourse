import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const unnecessaryElseAfterReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-else-after-return',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const elseClause = node.children.find((c) => c.type === 'else_clause')
    if (!consequence || !elseClause) return null

    const elseBody = elseClause.namedChildren[0]
    if (elseBody?.type === 'if_statement') return null

    function endsWithReturn(block: SyntaxNode): boolean {
      if (block.type === 'return_statement') return true
      if (block.type === 'statement_block') {
        const stmts = block.namedChildren
        if (stmts.length > 0 && stmts[stmts.length - 1].type === 'return_statement') return true
      }
      return false
    }

    function getReturnValue(block: SyntaxNode): string | null {
      let target = block
      if (target.type === 'statement_block') {
        const stmts = target.namedChildren
        if (stmts.length !== 1 || stmts[0].type !== 'return_statement') return null
        target = stmts[0]
      }
      if (target.type !== 'return_statement') return null
      const value = target.namedChildren[0]
      return value?.text ?? null
    }

    if (endsWithReturn(consequence)) {
      const trueVal = getReturnValue(consequence)
      const falseVal = elseBody ? getReturnValue(elseBody) : null
      if ((trueVal === 'true' && falseVal === 'false') || (trueVal === 'false' && falseVal === 'true')) {
        return null // Let redundant-boolean handle this
      }

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary else after return',
        'The else block is unnecessary because the if branch returns. Move the else body to the outer scope.',
        sourceCode,
        'Remove the else wrapper — the code after the if block will only run when the condition is false.',
      )
    }
    return null
  },
}
