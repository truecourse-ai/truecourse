import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects TypeScript private class members that are never reassigned after
 * initialization — they should be declared `readonly`.
 *
 * Targets TypeScript `private x: T` field declarations where:
 * - The field has no initializer, or only assigned once in the constructor
 * - It is never assigned again elsewhere in the class body
 */

function walkClassBody(body: SyntaxNode, cb: (n: SyntaxNode) => void): void {
  function walk(n: SyntaxNode): void {
    cb(n)
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(body)
}

/**
 * Check if a node represents an assignment to `this.propName`.
 * Covers =, +=, -=, etc. and ++ / -- updates.
 */
function isThisAssignment(n: SyntaxNode, propName: string): boolean {
  // assignment_expression: this.x = ..., this.x += ...
  if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
    const left = n.childForFieldName('left')
    if (!left || left.type !== 'member_expression') return false
    const obj = left.childForFieldName('object')
    const prop = left.childForFieldName('property')
    return obj?.text === 'this' && prop?.text === propName
  }

  // update_expression: this.x++ / this.x--
  if (n.type === 'update_expression') {
    const arg = n.namedChildren.find((c) => c.type === 'member_expression')
    if (!arg) return false
    const obj = arg.childForFieldName('object')
    const prop = arg.childForFieldName('property')
    return obj?.text === 'this' && prop?.text === propName
  }

  return false
}

export const mutablePrivateMemberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/mutable-private-member',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'class_body')
    if (!body) return null

    // Collect private field declarations (not already readonly)
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

    // Count assignments to each private field via `this.name = ...`
    const assignmentCounts = new Map<string, number>()

    for (const [name] of privateFields) {
      assignmentCounts.set(name, 0)
    }

    walkClassBody(body, (n) => {
      for (const [name] of privateFields) {
        if (isThisAssignment(n, name)) {
          assignmentCounts.set(name, (assignmentCounts.get(name) ?? 0) + 1)
        }
      }
    })

    // A field should be readonly if it is assigned at most once (in the constructor)
    for (const [name, nameNode] of privateFields) {
      const count = assignmentCounts.get(name) ?? 0
      if (count <= 1) {
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
    }

    return null
  },
}
