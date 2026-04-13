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

/**
 * True if the variable `name` is assigned (with `=`) later in the same
 * function body. This covers forward-declaration patterns like:
 *
 *   result: int          # bare annotation — forward declaration
 *   if cond:
 *       result = 1
 *   else:
 *       result = 2
 *
 * We walk the enclosing function body and look for any assignment to the
 * same variable name anywhere in the body (including inside if/else/for).
 */
function isAssignedLaterInScope(node: SyntaxNode, varName: string): boolean {
  // Find the enclosing function body (or module-level block)
  let scope: SyntaxNode | null = node.parent
  while (scope) {
    if (scope.type === 'block' && scope.parent?.type === 'function_definition') break
    if (scope.type === 'module') break
    scope = scope.parent
  }
  if (!scope) return false

  function hasAssignment(n: SyntaxNode): boolean {
    if (n.type === 'assignment') {
      const left = n.childForFieldName('left')
      if (left?.type === 'identifier' && left.text === varName) {
        // Must have an actual `=` sign — not just a type annotation
        if (n.children.some((c) => c.text === '=')) return true
      }
    }
    if (n.type === 'augmented_assignment') {
      const left = n.childForFieldName('left')
      if (left?.type === 'identifier' && left.text === varName) return true
    }
    // Don't recurse into nested function/class definitions
    if (n.type === 'function_definition' || n.type === 'class_definition') return false
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child && hasAssignment(child)) return true
    }
    return false
  }

  return hasAssignment(scope)
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

          // Skip forward declarations — the variable is assigned later
          // in the same scope (e.g., before an if/else that sets it).
          if (isAssignedLaterInScope(node, left.text)) return null

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
