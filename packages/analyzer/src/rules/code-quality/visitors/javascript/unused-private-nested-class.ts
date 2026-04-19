import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * Detects private nested classes that are never referenced within the outer class.
 * A nested class is considered private if it has a `private` accessibility modifier.
 */
export const unusedPrivateNestedClassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-private-nested-class',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'class_body')
    if (!body) return null

    // Collect private nested class declarations: name → nameNode
    const privateClasses = new Map<string, SyntaxNode>()
    for (const member of body.namedChildren) {
      // private static ClassName = class { ... } or field_definition holding a class
      if (
        member.type === 'field_definition' ||
        member.type === 'public_field_definition'
      ) {
        const isPrivate = member.children.some(
          (c) => c.type === 'accessibility_modifier' && c.text === 'private',
        )
        if (!isPrivate) continue
        // Check if the value is a class expression
        const valueNode = member.childForFieldName('value')
        if (!valueNode || (valueNode.type !== 'class' && valueNode.type !== 'class_declaration')) continue
        const nameNode = member.children.find(
          (c) => c.type === 'property_identifier' || c.type === 'private_property_identifier',
        )
        if (nameNode) {
          privateClasses.set(nameNode.text.replace(/^#/, ''), nameNode)
        }
      }
    }

    if (privateClasses.size === 0) return null

    // Collect all identifiers referenced in the class body (outside the nested class fields)
    const referenced = new Set<string>()
    function collectRefs(n: SyntaxNode) {
      if (n.type === 'identifier') referenced.add(n.text)
      if (n.type === 'private_property_identifier') referenced.add(n.text.replace(/^#/, ''))
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectRefs(child)
      }
    }
    collectRefs(body)

    for (const [name, nameNode] of privateClasses) {
      if (!referenced.has(name)) {
        return makeViolation(
          this.ruleKey,
          nameNode,
          filePath,
          'low',
          'Unused private nested class',
          `Private nested class \`${name}\` is never referenced. Remove it or use it.`,
          sourceCode,
          'Remove the unused private nested class or add a reference to it.',
        )
      }
    }
    return null
  },
}
