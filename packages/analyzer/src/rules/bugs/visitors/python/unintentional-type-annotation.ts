import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * True if `node` is a direct class-body statement — the nearest enclosing
 * definition is a `class_definition`, not a `function_definition`.
 *
 * Bare type annotations at class level (`name: str`, `id: int`) are
 * intentional field declarations in Pydantic, dataclasses, TypedDict,
 * attrs, SQLAlchemy, and plain classes. They are NEVER accidental.
 */
function isInsideClassBody(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'function_definition' || current.type === 'lambda') return false
    if (current.type === 'class_definition') return true
    current = current.parent
  }
  return false
}

export const pythonUnintentionalTypeAnnotationVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unintentional-type-annotation',
  languages: ['python'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null

    if (expr.type === 'assignment') {
      const hasEquals = expr.children.some((c) => c.text === '=')
      if (!hasEquals && expr.childForFieldName('type') !== null) {
        const left = expr.childForFieldName('left')
        const typeNode = expr.childForFieldName('type')
        if (left && typeNode) {
          // Skip class-body annotations — these are intentional field
          // declarations (Pydantic, dataclass, TypedDict, attrs, etc.).
          if (isInsideClassBody(node)) return null

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
