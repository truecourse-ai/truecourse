import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects TypeScript private class members that are never reassigned after
 * initialization — they should be declared `readonly`.
 *
 * Targets TypeScript `private x: T` field declarations where:
 * - The field has no initializer, or is only assigned once via `this.x = ...`
 * - It has no self-referential reassignment (`this.x = f(this.x)` style)
 *
 * Skipped (would produce false positives):
 * - Static fields — assignments use `ClassName.x = ...` not `this.x = ...`, so
 *   they cannot be reliably tracked; the singleton lazy-init pattern is the
 *   canonical example.
 * - Map / Set / WeakMap containers — intentionally mutated via `.set` / `.delete`.
 * - Fields whose own value is read on the right-hand side of an assignment
 *   (e.g. `this.handlers = this.handlers.filter(h => ...)`), which prove the
 *   reference is mutated structurally and cannot be `readonly`.
 */

function walk(node: SyntaxNode, cb: (n: SyntaxNode) => void): void {
  cb(node)
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child) walk(child, cb)
  }
}

/**
 * Check if a node represents an assignment to `this.propName`.
 * Covers =, +=, -=, etc. and ++ / -- updates.
 * Returns the assignment node and the RHS expression (or null for update_expression).
 */
function thisAssignmentInfo(
  n: SyntaxNode,
  propName: string,
): { isAssignment: true; rhs: SyntaxNode | null; isAugmented: boolean } | null {
  if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
    const left = n.childForFieldName('left')
    if (!left || left.type !== 'member_expression') return null
    const obj = left.childForFieldName('object')
    const prop = left.childForFieldName('property')
    if (obj?.text !== 'this' || prop?.text !== propName) return null
    const rhs = n.childForFieldName('right') ?? null
    return { isAssignment: true, rhs, isAugmented: n.type === 'augmented_assignment_expression' }
  }

  if (n.type === 'update_expression') {
    const arg = n.namedChildren.find((c) => c.type === 'member_expression')
    if (!arg) return null
    const obj = arg.childForFieldName('object')
    const prop = arg.childForFieldName('property')
    if (obj?.text !== 'this' || prop?.text !== propName) return null
    // update_expression (this.x++) implicitly reads then writes — treat as self-referential
    return { isAssignment: true, rhs: arg, isAugmented: true }
  }

  return null
}

/**
 * Does `expr` contain a read of `this.propName`?
 */
function readsThisProp(expr: SyntaxNode | null, propName: string): boolean {
  if (!expr) return false
  let found = false
  walk(expr, (n) => {
    if (found) return
    if (n.type === 'member_expression') {
      const obj = n.childForFieldName('object')
      const prop = n.childForFieldName('property')
      if (obj?.text === 'this' && prop?.text === propName) {
        found = true
      }
    }
  })
  return found
}

export const mutablePrivateMemberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/mutable-private-member',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'class_body')
    if (!body) return null

    // Collect private instance field declarations (not already readonly, not static)
    const privateFields = new Map<string, SyntaxNode>()

    for (const member of body.namedChildren) {
      if (member.type !== 'field_definition' && member.type !== 'public_field_definition') continue

      // Must have `private` accessibility modifier
      const hasPrivate = member.children.some(
        (c) => c.type === 'accessibility_modifier' && c.text === 'private',
      )
      if (!hasPrivate) continue

      // Skip if already `readonly`
      const hasReadonly = member.children.some((c) => c.text === 'readonly')
      if (hasReadonly) continue

      // Skip static fields — assignments use `ClassName.x = ...` (not `this.x = ...`),
      // so the visitor cannot reliably tell whether they are reassigned. Static
      // singleton lazy-init holders are the canonical FP.
      const isStatic = member.children.some((c) => c.type === 'static')
      if (isStatic) continue

      const nameNode = member.children.find(
        (c) => c.type === 'property_identifier' || c.type === 'private_property_identifier',
      )
      if (!nameNode) continue

      const name = nameNode.text.replace(/^#/, '')

      // Skip Map, Set, WeakMap — these are designed to be mutated via .set/.delete
      const typeAnnotation = member.children.find((c) => c.type === 'type_annotation')
      const typeText = typeAnnotation?.text ?? ''
      if (/\b(Map|Set|WeakMap)\b/.test(typeText)) continue

      // Also check initializer for `new Map()`, `new Set()`, `new WeakMap()`
      const initializer = member.children.find(
        (c) => c.type === 'new_expression',
      )
      if (initializer) {
        const ctor = initializer.childForFieldName('constructor')
        if (ctor && /^(Map|Set|WeakMap)$/.test(ctor.text)) continue
      }

      privateFields.set(name, nameNode)
    }

    if (privateFields.size === 0) return null

    // Walk every assignment to `this.x` for tracked fields. We track:
    //   - total simple assignments (count for "<=1 ⇒ candidate" heuristic)
    //   - whether any assignment is self-referential (reads `this.x` on the RHS,
    //     or is an augmented/update assignment which implicitly reads the field)
    const assignmentCounts = new Map<string, number>()
    const selfReferential = new Set<string>()
    for (const [name] of privateFields) assignmentCounts.set(name, 0)

    walk(body, (n) => {
      for (const [name] of privateFields) {
        const info = thisAssignmentInfo(n, name)
        if (!info) continue
        assignmentCounts.set(name, (assignmentCounts.get(name) ?? 0) + 1)
        if (info.isAugmented || readsThisProp(info.rhs, name)) {
          selfReferential.add(name)
        }
      }
    })

    for (const [name, nameNode] of privateFields) {
      if (selfReferential.has(name)) continue
      const count = assignmentCounts.get(name) ?? 0
      if (count > 1) continue

      return makeViolation(
        this.ruleKey,
        nameNode,
        filePath,
        'low',
        'Mutable private member should be readonly',
        `Private member \`${name}\` is never reassigned after initialization — declare it \`readonly\`.`,
        sourceCode,
        'Add the `readonly` modifier to the private member declaration.',
      )
    }

    return null
  },
}
