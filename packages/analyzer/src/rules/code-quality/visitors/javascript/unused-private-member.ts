import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * Detects private class fields that are never accessed inside the class body.
 *
 * Scope notes (kept narrow to avoid false positives on realistic codebases):
 * - Only flags private FIELDS, not private methods. Private methods are
 *   frequently scaffolded (event handlers, helpers reserved for future calls,
 *   methods invoked via callbacks the visitor cannot follow) — flagging them
 *   produces too much noise.
 * - Private constructors are never flagged (singleton pattern: invoked
 *   internally via `new ClassName()`, which is intentional).
 * - Tracks both `this.field` and `ClassName.field` access (so private static
 *   members accessed by class name — the typical singleton holder shape — are
 *   not flagged).
 * - Skips fields whose value is a class expression (handled by
 *   `unused-private-nested-class`).
 */
export const unusedPrivateMemberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-private-member',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'class_body')
    if (!body) return null

    // Resolve the class name (used to detect `ClassName.field` access patterns).
    const classNameNode = node.childForFieldName('name')
    const className = classNameNode?.text ?? ''

    const privateFields = new Map<string, SyntaxNode>()
    for (const member of body.namedChildren) {
      // Fields only — skip methods (too noisy) and constructors (singleton FPs).
      if (member.type !== 'field_definition' && member.type !== 'public_field_definition') continue
      const isPrivate =
        member.children.some((c) => c.type === 'accessibility_modifier' && c.text === 'private') ||
        member.children.some((c) => c.type === 'private_property_identifier')
      if (!isPrivate) continue
      // Exclude class-valued fields (handled by unused-private-nested-class).
      const valueNode = member.childForFieldName('value')
      if (valueNode && (valueNode.type === 'class' || valueNode.type === 'class_declaration')) continue
      const nameNode = member.children.find(
        (c) => c.type === 'property_identifier' || c.type === 'private_property_identifier',
      )
      if (nameNode) {
        const name = nameNode.text.replace(/^#/, '')
        privateFields.set(name, nameNode)
      }
    }

    if (privateFields.size === 0) return null

    const usedNames = new Set<string>()

    function walk(n: SyntaxNode) {
      if (n.type === 'member_expression') {
        const obj = n.childForFieldName('object')
        const prop = n.childForFieldName('property')
        if (prop) {
          const objText = obj?.text
          if (objText === 'this' || (className && objText === className)) {
            usedNames.add(prop.text.replace(/^#/, ''))
          }
        }
      }
      if (n.type === 'private_property_identifier') {
        usedNames.add(n.text.replace(/^#/, ''))
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(body)

    for (const [name, nameNode] of privateFields) {
      if (!usedNames.has(name)) {
        return makeViolation(
          this.ruleKey,
          nameNode,
          filePath,
          'medium',
          'Unused private member',
          `Private member \`${name}\` is never accessed. Remove it or make it used.`,
          sourceCode,
          'Remove the unused private member or access it somewhere in the class.',
        )
      }
    }
    return null
  },
}
