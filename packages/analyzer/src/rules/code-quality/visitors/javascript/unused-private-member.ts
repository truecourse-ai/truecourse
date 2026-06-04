import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import { isGeneratedFile } from '../../../_shared/javascript-helpers.js'

export const unusedPrivateMemberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-private-member',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    // Skip ANTLR / codegen output — the unused-looking private members are
    // generator scaffolding, not author-written code.
    if (isGeneratedFile(filePath, sourceCode)) return null

    const body = node.namedChildren.find((c) => c.type === 'class_body')
    if (!body) return null

    const privateMembers = new Map<string, SyntaxNode>()
    for (const member of body.namedChildren) {
      if (member.type === 'method_definition' || member.type === 'field_definition'
        || member.type === 'public_field_definition') {
        const isPrivate = member.children.some((c) => c.type === 'accessibility_modifier' && c.text === 'private')
          || member.children.some((c) => c.type === 'private_property_identifier')
        if (!isPrivate) continue
        const nameNode = member.children.find((c) => c.type === 'property_identifier' || c.type === 'private_property_identifier')
        if (nameNode) {
          const name = nameNode.text.replace(/^#/, '')
          // Constructors are invoked implicitly by `new` (often kept
          // private deliberately to enforce the Singleton pattern), which
          // the `this.X` usage detector below cannot see.
          if (name === 'constructor') continue
          privateMembers.set(name, nameNode)
        }
      }
    }

    if (privateMembers.size === 0) return null

    const usedNames = new Set<string>()

    // Static singleton members are accessed via the class name (e.g.
    // `Foo._instance = new Foo()` inside `Foo.getInstance`), not via `this`.
    // Resolve the enclosing class's identifier so those self-references count
    // as uses.
    const classNameNode = node.namedChildren.find(
      (c) => c.type === 'type_identifier' || c.type === 'identifier',
    )
    const className = classNameNode?.text

    function walk(n: SyntaxNode) {
      if (n.type === 'member_expression') {
        const obj = n.childForFieldName('object')
        const prop = n.childForFieldName('property')
        if (prop && (obj?.text === 'this' || (className && obj?.text === className))) {
          usedNames.add(prop.text.replace(/^#/, ''))
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

    for (const [name, nameNode] of privateMembers) {
      if (!usedNames.has(name)) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'medium',
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
