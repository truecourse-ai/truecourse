import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { unwrapParens } from './_helpers.js'

/**
 * A property setter that assigns to the property itself instead of its backing
 * field — `set { Name = value; }` inside the `Name` property. This recurses into
 * the setter forever (StackOverflowException) rather than storing the value.
 *
 * Only a bare assignment whose target is the property's own simple name (or
 * `this.Name`) is reported; `other.Name = value` or `Name[i] = value` write
 * something else and are left alone.
 */
function assignsOwnName(stmtParent: SyntaxNode, propName: string): SyntaxNode | null {
  for (const stmt of stmtParent.namedChildren) {
    if (stmt?.type !== 'expression_statement') continue
    const expr = stmt.namedChildren[0]
    if (expr?.type !== 'assignment_expression') continue
    if (expr.childForFieldName('operator')?.text !== '=') continue
    const left = expr.childForFieldName('left')
    if (!left) continue
    const target = unwrapParens(left)
    let name: string | null = null
    if (target.type === 'identifier') name = target.text
    else if (
      target.type === 'member_access_expression' &&
      target.childForFieldName('expression')?.type === 'this_expression'
    ) {
      name = target.childForFieldName('name')?.text ?? null
    }
    if (name === propName) return expr
  }
  return null
}

export const csharpPropertyAssignmentInOwnSetterVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/property-assignment-in-own-setter',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    const propName = node.childForFieldName('name')?.text
    if (!propName) return null

    const accessors = node.childForFieldName('accessors')
    if (accessors?.type !== 'accessor_list') return null

    for (const accessor of accessors.namedChildren) {
      if (accessor?.type !== 'accessor_declaration') continue
      if (accessor.childForFieldName('name')?.text !== 'set') continue
      const body = accessor.childForFieldName('body')
      if (body?.type !== 'block') continue

      const recursion = assignsOwnName(body, propName)
      if (!recursion) continue

      return makeViolation(
        this.ruleKey, recursion, filePath, 'high',
        'Property assigned within its own setter',
        `The setter for \`${propName}\` assigns to the property itself, recursing into the setter forever instead of writing the backing field.`,
        sourceCode,
        'Assign the backing field (e.g. `_field = value;`) instead of the property name.',
      )
    }
    return null
  },
}
