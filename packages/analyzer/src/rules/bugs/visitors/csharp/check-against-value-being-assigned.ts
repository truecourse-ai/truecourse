import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** The enclosing class/struct/record declaration of a node, if any. */
function enclosingTypeDecl(node: SyntaxNode): SyntaxNode | null {
  let p = node.parent
  while (p) {
    if (p.type === 'class_declaration' || p.type === 'struct_declaration' || p.type === 'record_declaration') {
      return p
    }
    p = p.parent
  }
  return null
}

/**
 * The simple name of an assignment target when it is a bare identifier (`Name`)
 * or a `this.Name` member access — the two shapes that can refer to a property
 * declared on the enclosing type. Anything else (`obj.Name`, indexers, etc.)
 * returns null.
 */
function selfMemberName(target: SyntaxNode): string | null {
  if (target.type === 'identifier') return target.text
  if (target.type === 'member_access_expression') {
    const obj = target.childForFieldName('expression')
    if (obj?.type === 'this') return target.childForFieldName('name')?.text ?? null
  }
  return null
}

/** True when the enclosing type declares a property with the given name. */
function enclosingTypeHasProperty(typeDecl: SyntaxNode, name: string): boolean {
  const body =
    typeDecl.childForFieldName('body') ?? typeDecl.namedChildren.find((c) => c?.type === 'declaration_list')
  if (!body) return false
  return body.namedChildren.some(
    (m) => m?.type === 'property_declaration' && m.childForFieldName('name')?.text === name,
  )
}

/** The single statement of an if-consequence, unwrapping a one-statement block. */
function singleStatement(consequence: SyntaxNode): SyntaxNode | null {
  if (consequence.type === 'block') {
    const stmts = consequence.namedChildren.filter((c) => c?.type !== 'comment')
    return stmts.length === 1 ? stmts[0]! : null
  }
  return consequence
}

/**
 * `if (x != v) x = v;` — guarding a plain assignment with an inequality check
 * against the very value being assigned is redundant: assigning `v` to `x` when
 * they already differ has the identical effect as assigning unconditionally.
 * The guard adds noise and often hides a copy-paste mistake (the author meant a
 * different right-hand side or a different comparison).
 *
 * Only fires when the guarded statement is exactly the assignment `x = v` whose
 * operands mirror the `x != v` condition, with no else branch and no other body.
 */
export const csharpCheckAgainstValueBeingAssignedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/check-against-value-being-assigned',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('alternative')) return null

    const condition = node.childForFieldName('condition')
    if (condition?.type !== 'binary_expression') return null
    if (condition.childForFieldName('operator')?.text !== '!=') return null
    const condLeft = condition.childForFieldName('left')
    const condRight = condition.childForFieldName('right')
    if (!condLeft || !condRight) return null

    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null
    const stmt = singleStatement(consequence)
    if (stmt?.type !== 'expression_statement') return null
    const assign = stmt.namedChildren[0]
    if (assign?.type !== 'assignment_expression') return null
    if (assign.childForFieldName('operator')?.text !== '=') return null

    const target = assign.childForFieldName('left')
    const value = assign.childForFieldName('right')
    if (!target || !value) return null

    // The condition must be exactly `target != value` (in either order).
    const sameAB = condLeft.text === target.text && condRight.text === value.text
    const sameBA = condLeft.text === value.text && condRight.text === target.text
    if (!sameAB && !sameBA) return null

    // Skip when the target is a property declared on the enclosing type (a bare
    // `Name` or `this.Name`). A property setter is observable — it can drive
    // change-tracking / auditing (e.g. EF Core) — so guarding the assignment with
    // `!=` is a deliberate optimization to avoid marking the entity dirty, not a
    // redundant no-op. A guard on a plain local or field still fires.
    const selfName = selfMemberName(target)
    if (selfName) {
      const typeDecl = enclosingTypeDecl(node)
      if (typeDecl && enclosingTypeHasProperty(typeDecl, selfName)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant check against the value being assigned',
      `\`if (${condition.text}) ${assign.text};\` guards a plain assignment with a check against the same value — assigning unconditionally has the identical effect.`,
      sourceCode,
      'Remove the guard and assign unconditionally, or fix the condition if a different check was intended.',
    )
  },
}
