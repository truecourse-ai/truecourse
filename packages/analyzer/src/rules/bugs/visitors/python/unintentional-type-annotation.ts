import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnintentionalTypeAnnotationVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unintentional-type-annotation',
  languages: ['python'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    // expression_statement containing only a type annotation (no assignment value)
    const expr = node.namedChildren[0]
    if (!expr) return null

    // In tree-sitter Python, a bare annotation `x: int` is an `expression_statement`
    // containing a `type_annotation` (Python 3.6+ syntax as an assignment without value)
    // Actually tree-sitter represents `x: int` as an assignment with no value — check for it
    if (expr.type === 'assignment') {
      // assignment with type annotation but no right side: `x: int`
      // tree-sitter represents this as type annotation only when there's no `=`
      const hasEquals = expr.children.some((c) => c.text === '=')
      if (!hasEquals && expr.childForFieldName('type') !== null) {
        const left = expr.childForFieldName('left')
        const typeNode = expr.childForFieldName('type')
        if (left && typeNode) {
          return makeViolation(
            this.ruleKey, expr, filePath, 'medium',
            'Unintentional type annotation',
            `\`${left.text}: ${typeNode.text}\` is a bare type annotation with no value — if you meant to assign a value, add \`= value\`. The annotation itself has no runtime effect.`,
            sourceCode,
            `Add an assignment: \`${left.text}: ${typeNode.text} = value\`.`,
          )
        }
      }
    }
    return null
  },
}
