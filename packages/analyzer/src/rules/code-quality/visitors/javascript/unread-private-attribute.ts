import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

/**
 * Detects private class attributes that are written but never read.
 * An attribute that is only stored (written) but never retrieved (read) is dead code.
 * This applies to TypeScript `private` fields and JavaScript `#field` syntax.
 */
export const unreadPrivateAttributeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unread-private-attribute',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'class_body')
    if (!body) return null

    // Collect private field definitions (non-method)
    const privateFields = new Map<string, SyntaxNode>()
    for (const member of body.namedChildren) {
      if (member.type !== 'field_definition' && member.type !== 'public_field_definition') continue
      const isPrivate =
        member.children.some((c) => c.type === 'accessibility_modifier' && c.text === 'private') ||
        member.children.some((c) => c.type === 'private_property_identifier')
      if (!isPrivate) continue
      // Exclude class-valued fields (those are for unused-private-nested-class)
      const valueNode = member.childForFieldName('value')
      if (valueNode && (valueNode.type === 'class' || valueNode.type === 'class_declaration')) continue
      const nameNode = member.children.find(
        (c) => c.type === 'property_identifier' || c.type === 'private_property_identifier',
      )
      if (nameNode) {
        privateFields.set(nameNode.text.replace(/^#/, ''), nameNode)
      }
    }

    if (privateFields.size === 0) return null

    // Track reads vs writes of this.field
    const readNames = new Set<string>()
    const writtenNames = new Set<string>()

    function walk(n: SyntaxNode) {
      if (n.type === 'member_expression') {
        const obj = n.childForFieldName('object')
        const prop = n.childForFieldName('property')
        if ((obj?.text === 'this' || obj?.type === 'this') && prop) {
          const fieldName = prop.text.replace(/^#/, '')
          const parent = n.parent
          if (parent) {
            const isWriteLeft =
              (parent.type === 'assignment_expression' || parent.type === 'augmented_assignment_expression') &&
              parent.childForFieldName('left')?.id === n.id
            if (isWriteLeft) {
              writtenNames.add(fieldName)
            } else {
              readNames.add(fieldName)
            }
          } else {
            readNames.add(fieldName)
          }
        }
      }
      // Handle #field style
      if (n.type === 'private_property_identifier') {
        const parent = n.parent
        if (parent?.type === 'member_expression') {
          // Already handled above via member_expression walk
        } else {
          readNames.add(n.text.replace(/^#/, ''))
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }
    walk(body)

    for (const [name, nameNode] of privateFields) {
      if (writtenNames.has(name) && !readNames.has(name)) {
        return makeViolation(
          this.ruleKey,
          nameNode,
          filePath,
          'low',
          'Unread private attribute',
          `Private attribute \`${name}\` is written but never read. The stored value is never used.`,
          sourceCode,
          'Remove the attribute if it is not needed, or read it somewhere to make the write meaningful.',
        )
      }
    }
    return null
  },
}
