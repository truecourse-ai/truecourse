import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const preferNullishCoalescingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-nullish-coalescing',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['ternary_expression'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    const consequence = node.childForFieldName('consequence')

    if (!condition || !consequence) return null

    function getCheckedVar(cond: SyntaxNode): string | null {
      if (cond.type === 'binary_expression') {
        const op = cond.children.find((c) => c.type === '!=' || c.type === '!==')
        if (op) {
          const left = cond.childForFieldName('left')
          const right = cond.childForFieldName('right')
          if (left?.type === 'identifier' && (right?.text === 'null' || right?.text === 'undefined')) {
            return left.text
          }
        }
      }
      if (cond.type === 'logical_expression' || cond.type === 'binary_expression') {
        const logOp = cond.children.find((c) => c.type === '&&')
        if (logOp) {
          const l = cond.childForFieldName('left')
          const r = cond.childForFieldName('right')
          if (l && r) {
            const lVar = getCheckedVar(l)
            const rVar = getCheckedVar(r)
            if (lVar && lVar === rVar) return lVar
          }
        }
      }
      return null
    }

    const checkedVar = getCheckedVar(condition)
    if (!checkedVar) return null

    if (consequence.type === 'identifier' && consequence.text === checkedVar) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Prefer nullish coalescing',
        `\`${condition.text} ? ${consequence.text} : ...\` can be simplified to \`${checkedVar} ?? ...\`.`,
        sourceCode,
        `Replace with \`${checkedVar} ?? <default>\`.`,
      )
    }
    return null
  },
}
